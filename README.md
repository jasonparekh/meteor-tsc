meteor-tsc
==========

Batch (fast) TypeScript compiler for Meteor.  Currently, in order to maintain Meteor's ordering conventions, your codebase must be all TypeScript (or other source languages should not depend on the TypeScript files being loaded before them.)

This is experimental at the moment; you're free to use it and file bugs, but it's a hacky approach to performing a batch compilation without proper Meteor support. (It creates a placeholder file that indicates Meteor has handed the plugin all of the main source files -- look through the source if you're curious how it works.)
