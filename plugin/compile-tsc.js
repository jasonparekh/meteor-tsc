// NOTE: This has inherent issues in a codebase of differing source languages.
// E.g. imagine I have lib/a.ts, something/foo.coffee (which depends on a.ts),
// and a bunch of other .ts files. The problem is we batch all of the .ts
// together and execute the TypeScript compiler when we get the latest .ts
// file, but by then the coffee compiler has already been compiled.
// At the moment, Meteor takes addJavaScript calls and places them directly
// into the index.html in that order, so the coffee will come before
// our lib/a.ts.js.

// TODO Potential optimization is use ES3 across browser and Meteor, and have one compile

var fs = Npm.require('fs');
var Future = Npm.require('fibers/future');
var Fiber = Npm.require('fibers');
//var ts = Npm.require('ts-compiler');
var storage = Npm.require('node-persist');
var exec = Npm.require('child_process').exec;
var glob = Npm.require('glob');
var path = Npm.require('path');
var temp = Npm.require('temp');
var rimraf = Npm.require('rimraf');

var fsStat = Future.wrap(fs.stat);
storage.initSync({
  dir: 'typescript-cache'
});

this.archs = this.archs || {};
function initArch(archName) {
  var arch = archs[archName] = {name: archName};
  arch.modTimes = {};
  arch.cachedErrorReplays = [];
  resetCompilationScopedArch(arch);
}

var tsErrorRegex = /(.*[.]ts)\((\d+),(\d)+\): (.+)/;
var placeholderFileName = "main.tsc_placeholder.ts";
var cordovaPlatformsFileName = ".meteor/cordova-platforms";

var tscPath = function() {
  var bins = glob.sync("~/.meteor/packages/*:tsc/*/plugin.compileTsc.os/npm/compileTsc/node_modules/typescript/bin/tsc").concat(
        glob.sync("packages/*:tsc/.npm/plugin/compileTsc/node_modules/typescript/bin/tsc"),
        glob.sync("/usr/local/bin/tsc"));
  return bins[0];
}();
if (!tscPath) {
  console.error("Could not find tsc binary")
}

checkForPlaceholderFile();

Plugin.registerSourceHandler("ts", function (compileStep) {
  if (typeof(archs[compileStep.arch]) === 'undefined') {
    if (compileStep.arch === 'web.cordova' && !fs.existsSync(cordovaPlatformsFileName)) {
      // Don't bother compiling for cordova if the 'cordova-platforms' file does not exist
      return;
    }

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
    checkForPlaceholderFile(compileStep);
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
    addJavaScriptFromCacheInOrder(arch);

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
    'skipWrite': true
  };

  // This is synchronous (and our callback will get called multiple times if there are errors)
  tscCompile(arch.inputPaths, compileOptions, function(err, results) {
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
      var src = processGenSource(res.text || "");
      storage.setItem(b64encode(compileStep.inputPath), src);
    });
  });

  console.log("Done")
  addJavaScriptFromCacheInOrder(arch);
}

// Generally matches the signature of the previous ts.compile
function tscCompile(inputPaths, compileOptions, cb) {
  var out = temp.mkdirSync('tsc-out');
  var args = '"' + [tscPath, '--outDir', out, '--target', compileOptions.target || 'ES5'].concat(inputPaths).join('" "') + '"';
  var fiber = Fiber.current;
  exec(args, function(err, stdout, stderr) {
    if (stderr) {
      cb(stderr);
      fiber.run();
      return
    }

    res = glob.sync(path.join(out, '**', '*.js')).map(function(f) {
      return {
        name: path.join(process.cwd(), f.substr(out.length + 1)),
        text: fs.readFileSync(f, {encoding: 'utf8'})
      }
    });

    rimraf.sync(out);
    cb(undefined, res);
    fiber.run();
  });

  Fiber.yield();
}

function processGenSource(src) {
  var lines = src.split("\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.toLowerCase().trim() == "//tsc export" && i + 1 < lines.length) {
      // Removes "var" for var, function and class definitions
      lines[i+1] = lines[i+1].replace(/\s?var\s/, "     ");
      // Replaces the original "var xyz;" (before the above line executed) with a "if (typeof xyz == 'undefined') { xyz = {}; }" for modules
      lines[i+1] = lines[i+1].replace(/^\s*([$A-Z_][0-9A-Z_$]*);$/i, "if (typeof $1 == 'undefined') { $1 = {}; }");
      i++;
    }
  }

  return lines.join("\n");
}

function addJavaScriptFromCacheInOrder(arch) {
  arch.compileSteps.forEach(function(compileStep) {
    compileStep.addJavaScript({
      path: compileStep.inputPath + ".js",
      sourcePath: compileStep.inputPath,
      data: storage.getItem(b64encode(compileStep.inputPath)) || ""
    })
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

function checkForPlaceholderFile(compileStep) {
  if (!fs.existsSync(placeholderFileName)) {
    fs.writeFileSync(placeholderFileName, "");
    errorMsg = "Missing required \"" + placeholderFileName + "\" file; it has been created (make sure to add it to your .gitignore). You may have to touch a .ts file to trigger another compilation.";
    if (typeof(compileStep) !== 'undefined') {
      compileStep.error({message: errorMsg});
    } else {
      console.error(errorMsg);
    }
  }
}

function b64encode(s) {
  return new Buffer(s).toString('base64');
}
