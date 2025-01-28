# Contributing to Aide

Welcome, and thank you for your interest in contributing to Aide!

There are several ways in which you can contribute, beyond writing code. The goal of this document is to provide a high-level overview of how you can get involved.

## Contributing Fixes

If you are interested in writing code to fix issues, please see [How to Contribute](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md).

## Asking Questions

Have a question? The [Aide Discord](https://discord.gg/mtgrhXM5Xf) is a community created and maintained by the CodeStory team for Aide contributors and users to collaborate, help one another and communicate with the development team. This Discord community contains many discussion channels that you could find helpful.

## Providing Feedback

Your comments and feedback are welcome, and the development team is available via a handful of different channels.

### GitHub issues
[GitHub issues](https://github.com/codestoryai/aide/issues) should be used for bugs and feature requests. How to submit good bugs and feature requests is described in [How to Contribute](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md) and how we track issues is described in [[Issue Tracking]].

### Discord
As mentioned above, the [Aide Discord](https://discord.gg/mtgrhXM5Xf) has the development team available to look at your feedback. If there is an action to be tracked, an issue will be created on GitHub for providing visibility into the status of the feedback.

### Twitter
Watch for tweets from the [**@aide_dev**](https://twitter.com/aide_dev) account on twitter for announcements and updates from the team.

## Reporting Issues

Have you identified a reproducible problem in Aide? Do you have a feature request? We want to hear about it! Here's how you can report your issue as effectively as possible.

### Identify Where to Report

Can you recreate the issue even after [disabling all extensions](https://code.visualstudio.com/docs/editor/extension-gallery#_disable-an-extension)? If you find the issue is caused by an extension you have installed, please file an issue on the extension's repo directly.

The Aide project is distributed across multiple repositories. Try to file the issue against the correct repository.

#### Maintained by the CodeStory team
|Component|Repository|
|---|---|
|The Aide code editor|[aide](https://github.com/codestoryai/aide)|
|AI sidecar|[sidecar](https://github.com/codestoryai/sidecar)|

#### Maintained by the VSCode team
We regularly pull changes from the VSCode project into Aide, so issues reported here when fixed will automatically be included in Aide. But if the fix is urgent and important, just file them under the [aide](https://github.com/codestoryai/aide) repository and we will follow up as required.

|Component|Repository|
|---|---|
|Standalone Monaco Editor|[monaco-editor](https://github.com/Microsoft/monaco-editor)|
|Node Debug (for node < v8.0)|[vscode-node-debug](https://github.com/microsoft/vscode-node-debug)|
|Node Debug (for node >= v6.3)|[vscode-node-debug2](https://github.com/microsoft/vscode-node-debug2)|
|Node Debug Adapter |[vscode-debugadapter-node](https://github.com/Microsoft/vscode-debugadapter-node)|
|Chrome Debug Core| [vscode-chrome-debug-core](https://github.com/Microsoft/vscode-chrome-debug-core)|
|File Watcher|[vscode-filewatcher-windows](https://github.com/microsoft/vscode-filewatcher-windows)|
|`vscode.d.ts`|[vscode-extension-code](https://github.com/microsoft/vscode-extension-vscode)|
|`vscode-languageserver`|[vscode-languageserver-node](https://github.com/microsoft/vscode-languageserver-node)|
|TextMate tokenizer|[vscode-textmate](https://github.com/microsoft/vscode-textmate)|
|AMD Loader|[vscode-loader](https://github.com/microsoft/vscode-loader)|
|Windows Process Tree|[vscode-windows-process-tree](https://github.com/microsoft/vscode-windows-process-tree)|
|References View|[vscode-references-view](https://github.com/microsoft/vscode-references-view)|
|Octicons Font|[vscode-octicons-font](https://github.com/microsoft/vscode-octicons-font)|
|Terminal frontend|[xterm.js](https://github.com/xtermjs/xterm.js)
|Terminal backend|[node-pty](https://github.com/microsoft/node-pty)

### Look For an Existing Issue

Before you create a new issue, please do a search in [open issues](https://github.com/microsoft/vscode/issues) to see if the issue or feature request has already been filed.

Be sure to scan through the [most popular](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc) feature requests.

If you find your issue already exists, make relevant comments and add your [reaction](https://github.com/blog/2119-add-reactions-to-pull-requests-issues-and-comments). Use a reaction in place of a "+1" comment:

* 👍 - upvote
* 👎 - downvote

If you cannot find an existing issue that describes your bug or feature, create a new issue using the guidelines below.

### Writing Good Bug Reports and Feature Requests

File a single issue per problem and feature request. Do not enumerate multiple bugs or feature requests in the same issue.

Do not add your issue as a comment to an existing issue unless it's for the identical input. Many issues look similar but have different causes.

The more information you can provide, the more likely someone will be successful at reproducing the issue and finding a fix.

The built-in tool for reporting an issue, which you can access by using `Report Issue` in Aide's Help menu, can help streamline this process by automatically providing the version of Aide, all your installed extensions, and your system info. Additionally, the tool will search among existing issues to see if a similar issue already exists.

Please include the following with each issue:

* Version of Aide
* Your operating system
* List of extensions that you have installed
* Reproducible steps (1... 2... 3...) that cause the issue
* What you expected to see, versus what you actually saw
* Images, animations, or a link to a video showing the issue occurring
* A code snippet that demonstrates the issue or a link to a code repository the developers can easily pull down to recreate the issue locally
  * **Note:** Because the developers need to copy and paste the code snippet, including a code snippet as a media file (i.e. .gif) is not sufficient.
* Errors from the Dev Tools Console (open from the menu: Help > Toggle Developer Tools)

### Creating Pull Requests

* Please refer to the article on [creating pull requests](https://github.com/codestoryai/aide/blob/cs-main/HOW_TO_CONTRIBUTE.md#pull-requests) and contributing to this project.

### Final Checklist

Please remember to do the following:

* [ ] Search the issue repository to ensure your report is a new issue
* [ ] Recreate the issue after disabling all extensions
* [ ] Simplify your code around the issue to better isolate the problem

Don't feel bad if the developers can't reproduce the issue right away. They will simply ask for more information!

### Follow Your Issue

Once submitted, your report will go into the [issue tracking](https://github.com/microsoft/vscode/wiki/Issue-Tracking) workflow. Be sure to understand what will happen next, so you know what to expect and how to continue to assist throughout the process.

## Thank You

Your contributions to open source, large or small, make projects like this possible. Thank you for taking the time to contribute.
