var Future = Npm.require('fibers/future');
var ts = Npm.require('ts-compiler');

var tsInputPaths = [];

Plugin.registerSourceHandler("ts", function (compileStep) {

  if (compileStep.inputPath !== "main.tsc_placeholder.ts") {
    if (tsInputPaths.indexOf(compileStep.inputPath) != -1) {
      compileStep.error({message: "Missing required \"/main.tsc_placeholder.ts\" file (make sure to add it to your .gitignore too)"})
      return;
    }

    tsInputPaths.push(compileStep.inputPath);
    return;
  }




  tsInputPaths = [];

  console.log(compileStep.inputPath, compileStep);
});
