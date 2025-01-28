<div id="vscodium-logo" align="center">
    <img src="./media/logo.svg" alt="Aide Logo" width="160"/>
    <h1>Aide</h1>
</div>

**Aide is the Open Source AI-native code editor. It is a fork of VS Code, and integrates tightly with [the leading agentic framework](https://github.com/codestoryai/sidecar) on swebench-lite.**

![Latest release](https://img.shields.io/github/v/release/codestoryai/binaries?label=version)
![Discord Shield](https://discord.com/api/guilds/1138070673756004464/widget.png?style=shield)

<p align="center">
	<img src="./media/hero_video.gif" alt="Aide in action" />
</p>

Aide combines the powerful features of VS Code with advanced AI capabilities to provide:

* **A combined chat + edit flow** - Brainstorm a problem in chat by referencing files and jump into edits (which can happen across multiple files).
* **Proactive agents** - AI iterates on linter errors (provided by the Language Server) and pulls in relevant context using go-to-definitions, go-to-references, etc to propose fixes or ask for more context from you.
* **Inline editing widget** - Similar to the macos spotlight widget, press Ctrl/Cmd+K at any point to give instructions to AI.
* **Intelligent Code Completion** - Context-aware code suggestions powered by state-of-the-art AI models.
* **AST navigation** - Quickly navigate files in blocks rather than line-by-line.

Aide is designed to be your intelligent coding companion, helping you write better code faster while maintaining full control over your development process.

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/codestoryai/aide/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/codestoryai/aide/pulls)

If you are interested in fixing issues and contributing directly to the code base,
please see the document **[How to Contribute](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md)**, which covers the following:

* **[How to build and run from source](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md)**
* [The development workflow, including debugging and running tests](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md#debugging)
* [Coding guidelines](https://github.com/codestoryai/aide/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md#pull-requests)
* [Finding an issue to work on](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md#where-to-contribute)

## Feedback

* [File an issue](https://github.com/codestoryai/aide/issues)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/codestoryai/aide/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* Join our community: [Discord](https://discord.gg/mtgrhXM5Xf)

## Code of Conduct

This project has adopted the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Please read the Code of Conduct before contributing to this project.

## Acknowledgements

We would like to acknowledge [Cody](https://github.com/sourcegraph/cody) for Open Sourcing and creating the inline completion bit. This is one of those parts of the codebase where we borrowed heavily from Cody's work and we are grateful for that. We added our own necessities on top of this to make it work with the `sidecar`.
This part of the codebase is no longer maintained, we have since moved forward our focus to working on agentic workflows and if you want to revamp this part, please let us know!
We believe inline completion UX is ripe for innovation and there are many directions we can take this.

## License

Copyright (c) 2024 CodeStory AI. All rights reserved.
Licensed under the [GNU Affero General Public License v3.0](LICENSE.md).
