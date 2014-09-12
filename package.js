
Package.describe({
	summary: "Batch (fast) TypeScript compiler for Meteor",
  version: "1.0.9",
  git: "https://github.com/jasonparekh/meteor-tsc.git",
	version: "1.0.9"
});

Package._transitional_registerBuildPlugin({
	name: "compileTsc",
	use: [],
	sources: [
		'plugin/compile-tsc.js'
	],
	npmDependencies: {
		"ts-compiler": "2.0.0",
		"node-persist": "0.0.2"
	}
});
