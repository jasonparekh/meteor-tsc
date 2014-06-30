
Package.describe({
	summary: "Batch (fast) TypeScript compiler for Meteor"
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
