
Package.describe({
	summary: "Batch (fast) TypeScript compiler for Meteor",
  version: "1.0.11",
  git: "https://github.com/jasonparekh/meteor-tsc.git",
	version: "1.0.11"
});

Package._transitional_registerBuildPlugin({
	name: "compileTsc",
	use: [],
	sources: [
		'plugin/compile-tsc.js'
	],
	npmDependencies: {
		"typescript": "1.4.1",
		"node-persist": "0.0.2",
		"temp": "0.8.1",
		"glob": "4.3.5",
		"rimraf": "2.2.8"
	}
});
