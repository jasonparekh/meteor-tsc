// TODO Test whether a Meteor project of only server files (or only client files) ends up doing two passes too (if it does not, this will break)

var fs = Npm.require('fs');
var Fiber = Npm.require('fibers');
var Future = Npm.require('fibers/future');
var ts = Npm.require('ts-compiler');

var tsInputPaths = [];
var fullPathsToCompileSteps = {};

var tsErrorRegex = /(.*[.]ts)\((\d+),(\d)+\): (.+)/;
var placeholderFileName = "main.tsc_placeholder.ts";

Plugin.registerSourceHandler("ts", function (compileStep) {

  if (compileStep.inputPath !== placeholderFileName) {
    handleSourceFile(compileStep);
    return;
  }

  compile(compileStep);
  compilationFinished();
});

// Save the file input path, and return back to Meteor
function handleSourceFile(compileStep) {
  // Ensures the placeholder file exists. If the placeholder file is absent, tsInputPaths would never get cleared.
  if (tsInputPaths.indexOf(compileStep.inputPath) != -1) {
    fs.writeFileSync(placeholderFileName, "");
    compileStep.error({message: "Missing required \"" + placeholderFileName + "\" file; it has been created (make sure to add it to your .gitignore). You may have to touch a .ts file to trigger another compilation."});
    return;
  }

  tsInputPaths.push(compileStep.inputPath);
  fullPathsToCompileSteps[compileStep._fullInputPath] = compileStep;
}

function compile(placeholderCompileStep) {
  var browser = placeholderCompileStep.arch === "browser";
  var errorCount = 0;

  console.log("\nCompiling TypeScript files " + (browser ? "client" : "server") + "...");

  // AFAICT, this is synchronous (and our callback can get called multiple times if there are errors)
  compileOptions = {
    'target': (browser ? 'ES3' : 'ES5'),
    'skipWrite': true,
    'removeComments': true
  };
  ts.compile(tsInputPaths, compileOptions, function(err, results) {
    if (err) {
      recordError(err, placeholderCompileStep, ++errorCount);
      return;
    }

    results.forEach(function(res) {
      // res.name is the theoretically-generated js filename
      var tsFullPath = res.name.substr(0, res.name.length-2) + "ts";
      var compileStep = fullPathsToCompileSteps[tsFullPath];

      if (res.text.length == 0) {
        return;
      }

      compileStep.addJavaScript({
        path: compileStep.inputPath + ".js",
        sourcePath: compileStep.inputPath,
        data: res.text
      });
    });
  });
}

function recordError(err, placeholderCompileStep, errorNumber) {
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

function compilationFinished() {
  tsInputPaths = [];
  fullPathsToCompileSteps = {};
}
