
Package.describe({
	summary: "Experimental advanced TypeScript compiler focusing on speed"
});

Package._transitional_registerBuildPlugin({
	name: "compileTsc",
	use: [],
	sources: [
		'plugin/compile-tsc.js'
	],
	npmDependencies: {"ts-compiler": "2.0.0"}
});
