// TODO Test whether a Meteor project of only server files (or only client files) ends up doing two passes too (if it does not, this will break)

var fs = Npm.require('fs');
var Fiber = Npm.require('fibers');
var Future = Npm.require('fibers/future');
var ts = Npm.require('ts-compiler');
//var storage = Npm.require('node-persist');

var fsStat = Future.wrap(fs.stat);
//storage.initSync();

// "this." allows for modTimes to survive across changes to compile-tsc.js (useful during tsc devel)
this.modTimesByArch = this.modTimesByArch || {};

var cachedContents = {};
var cachedErrorsByArch = {};

var tsInputPaths = [];
var fullPathsToCompileSteps = {};
var inputPathsToCompileSteps = {};

var tsErrorRegex = /(.*[.]ts)\((\d+),(\d)+\): (.+)/;
var placeholderFileName = "main.tsc_placeholder.ts";

Plugin.registerSourceHandler("ts", function (compileStep) {
  if (compileStep.inputPath !== placeholderFileName) {
    handleSourceFile(compileStep);
    return;
  }

  var hadMod = checkAgainstModTime(compileStep.arch);
  if (!hadMod) tsInputPaths = [];
  compile(compileStep, hadMod);
  compilationFinished(compileStep.arch);
});

// Save the file input path, and return back to Meteor
function handleSourceFile(compileStep) {
  // Ensures the placeholder file exists. If the placeholder file is absent, tsInputPaths would never get cleared.
  if (tsInputPaths.indexOf(compileStep.inputPath) != -1) {
    fs.writeFileSync(placeholderFileName, "");
    compileStep.error({message: "Missing required \"" + placeholderFileName + "\" file; it has been created (make sure to add it to your .gitignore). You may have to touch a .ts file to trigger another compilation."});
    return;
  }

  console.log(compileStep.arch, compileStep.inputPath);
  tsInputPaths.push(compileStep.inputPath);
  fullPathsToCompileSteps[compileStep._fullInputPath] = compileStep;
  inputPathsToCompileSteps[compileStep.inputPath] = compileStep;
}

function checkAgainstModTime(arch) {
  modTimesByArch[arch] = modTimesByArch[arch] || {};

  var hadModifications = false;
  tsInputPaths.forEach(function(path) {
    stats = fsStat(path).wait();
    if (typeof(modTimesByArch[arch][path]) === 'undefined' || modTimesByArch[arch][path].toString() !== stats.mtime.toString()) {
      console.log(path,"had mods");
      hadModifications = true;
    }

    modTimesByArch[arch][path] = stats.mtime;
  });

  return hadModifications;
}

function compile(placeholderCompileStep, hadModifications) {
  var arch = placeholderCompileStep.arch;
  cachedErrorsByArch[arch] = cachedErrorsByArch[arch] || [];

  if (tsInputPaths.length == 0) {
    return;
  }

  if (!hadModifications) {
    // Short-circuit via cache
    tsInputPaths.forEach(function(path) {
      var compileStep = inputPathsToCompileSteps[path];

      compileStep.addJavaScript({
        path: path + ".js",
        sourcePath: path,
        data: cachedContents[path]//storage.getItem(path)
      })
    });

    // Replay errors
    cachedErrorsByArch[arch].forEach(function(args) {
      recordError(args.err, placeholderCompileStep, args.errorNumber, arch, true);
    });

    return;
  }

  cachedErrorsByArch[arch] = [];
  var browser = arch === "browser";
  var errorCount = 0;

  console.log("\nCompiling TypeScript " + (browser ? "client" : "server") + " files...");

  // AFAICT, this is synchronous (and our callback can get called multiple times if there are errors)
  compileOptions = {
    'target': (browser ? 'ES3' : 'ES5'),
    'skipWrite': true,
    'removeComments': true
  };
  ts.compile(tsInputPaths, compileOptions, function(err, results) {
    if (err) {
      recordError(err, placeholderCompileStep, ++errorCount, arch, false);
      return;
    }

    results.forEach(function(res) {
      // res.name is the theoretically-generated js filename
      var tsFullPath = res.name.substr(0, res.name.length-2) + "ts";
      var compileStep = fullPathsToCompileSteps[tsFullPath];

      compileStep.addJavaScript({
        path: compileStep.inputPath + ".js",
        sourcePath: compileStep.inputPath,
        data: res.text
      });

//      storage.setItem(compileStep.inputPath, res.text);
      cachedContents[compileStep.inputPath] = res.text;
    });
  });
}

function recordError(err, placeholderCompileStep, errorNumber, arch, isFromCache) {
  if (!isFromCache) {
    cachedErrorsByArch[arch].push({err: err, errNumber: errorNumber});
  }

  if (match = tsErrorRegex.exec(err.toString())) {
    var compileStep = fullPathsToCompileSteps[match[1]];
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

function compilationFinished(arch) {
  tsInputPaths = [];
  fullPathsToCompileSteps = {};
  inputPathsToCompileSteps = {};
}
