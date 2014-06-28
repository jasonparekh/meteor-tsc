// Potential optimization is use ES3 across browser and Meteor, and have one compile

var fs = Npm.require('fs');
var Fiber = Npm.require('fibers');
var Future = Npm.require('fibers/future');
var ts = Npm.require('ts-compiler');
var storage = Npm.require('node-persist');

var fsStat = Future.wrap(fs.stat);
storage.initSync({
  dir: 'typescript-cache'
});

this.archs = this.archs || {};
function initArch(archName) {
  archs[archName] = {name: archName};
  var arch = archs[archName];
  arch.modTimes = {};
  arch.cachedErrorReplays = [];
  resetCompilationScopedArch(arch);
}

var tsErrorRegex = /(.*[.]ts)\((\d+),(\d)+\): (.+)/;
var placeholderFileName = "main.tsc_placeholder.ts";

Plugin.registerSourceHandler("ts", function (compileStep) {
  if (typeof(archs[compileStep.arch]) === 'undefined') {
    initArch(compileStep.arch);
  }

  if (compileStep.inputPath !== placeholderFileName) {
    handleSourceFile(compileStep);
    return;
  }

  // Typically, Meteor hands us all of the files pertaining to an arch in clumps (i.e. all files for browser, then all files for os), so most compiles are only two phases (client and server).
  for (var archName in archs) {
    var arch = archs[archName];
    if (arch.compileSteps.length == 0) {
      continue;
    }

    var hadMod = checkAgainstModTime(arch);
    compile(arch, compileStep, hadMod);
    resetCompilationScopedArch(arch);
  }
});

// Save the file input path, and return back to Meteor
function handleSourceFile(compileStep) {
  var arch = archs[compileStep.arch];

  // This ensures the placeholder file exists. If the placeholder file is absent, we would have never triggered compilation, so the inputPaths would never have gotten cleared.
  if (arch.inputPaths.indexOf(compileStep.inputPath) != -1) {
    fs.writeFileSync(placeholderFileName, "");
    compileStep.error({message: "Missing required \"" + placeholderFileName + "\" file; it has been created (make sure to add it to your .gitignore). You may have to touch a .ts file to trigger another compilation."});
    return;
  }

  arch.inputPaths.push(compileStep.inputPath);
  arch.compileSteps.push(compileStep);
  arch.fullPathToCompileSteps[compileStep._fullInputPath] = compileStep;
}

function checkAgainstModTime(arch) {
  var hadModifications = false;
  arch.inputPaths.forEach(function(path) {
    stats = fsStat(path).wait();
    if (typeof(arch.modTimes[path]) === 'undefined' || arch.modTimes[path].toString() !== stats.mtime.toString()) {
      hadModifications = true;
    }

    arch.modTimes[path] = stats.mtime;
  });

  return hadModifications;
}

function compile(arch, placeholderCompileStep, hadModifications) {
  if (!hadModifications) {
    // Short-circuit via cache
    arch.compileSteps.forEach(function(compileStep) {
      compileStep.addJavaScript({
        path: compileStep.inputPath + ".js",
        sourcePath: compileStep.inputPath,
        data: storage.getItem(b64encode(compileStep.inputPath)) || ""
      })
    });

    // Replay errors
    arch.cachedErrorReplays.forEach(function(errReplay) {
      recordError(errReplay.err, placeholderCompileStep, errReplay.errorNumber, arch, true);
    });

    return;
  }

  console.log("\nCompiling TypeScript " + arch.name + " files...");

  // Clear cached errors since we're about to re-compile
  arch.cachedErrorReplays = [];
  var errorCount = 0;
  var compileOptions = {
    'target': (arch.name === 'browser' ? 'ES3' : 'ES5'),
    'skipWrite': true,
    'removeComments': true
  };

  // This is synchronous (and our callback will get called multiple times if there are errors)
  ts.compile(arch.inputPaths, compileOptions, function(err, results) {
    if (err) {
      // TODO
      recordError(err, placeholderCompileStep, ++errorCount, arch, false);
      if (typeof(results) === 'undefined') {
        return;
      }
    }

    results.forEach(function(res) {
      // res.name is the theoretically-generated js filename
      var tsFullPath = res.name.substr(0, res.name.length-2) + "ts";
      var compileStep = arch.fullPathToCompileSteps[tsFullPath];

      compileStep.addJavaScript({
        path: compileStep.inputPath + ".js",
        sourcePath: compileStep.inputPath,
        data: res.text
      });

      storage.setItem(b64encode(compileStep.inputPath), res.text || "");
    });
  });
}

function recordError(err, placeholderCompileStep, errorNumber, arch, isFromCache) {
  if (!isFromCache) {
    arch.cachedErrorReplays.push({err: err, errNumber: errorNumber});
  }

  if (match = tsErrorRegex.exec(err.toString())) {
    var compileStep = arch.fullPathToCompileSteps[match[1]];
    if (compileStep) {
      compileStep.error({
        message: match[4],
        sourcePath: match[1],
        line: match[2],
        column: match[3]
      });
      return;
    }
  }

  placeholderCompileStep.error({
    message: err.toString(),
    sourcePath: placeholderCompileStep.inputPath,
    line: errorNumber,
    column: 1
  });
}

function resetCompilationScopedArch(arch) {
  arch.inputPaths = [];
  arch.compileSteps = [];
  arch.fullPathToCompileSteps = {};
}

function b64encode(s) {
  return new Buffer(s).toString('base64');
}
