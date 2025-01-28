/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';

export class ProjectContext {
	fileIndicators: Map<string, string[]>;
	contentIndicators: Map<string, (fileContent: string) => string[]>;
	_labels: string[];
	constructor() {
		this.fileIndicators = new Map();
		this.contentIndicators = new Map();
		this._labels = [];
		this.initializeIndicators();
	}

	get labels() {
		if (
			this._labels.includes('javascript') &&
			this._labels.includes('typescript')
		) {
			const index = this._labels.indexOf('javascript');
			this._labels.splice(index, 1);
		}
		return this._labels;
	}

	async collectContext() {
		const workspaceFolders = vscode.workspace.workspaceFolders;
		if (workspaceFolders !== undefined) {
			await Promise.all(workspaceFolders.map(async (folder) => {
				await this.addContextForFolder(folder.uri.fsPath);
			}));
		}
	}

	async addContextForFolder(folderPath: string) {
		await Promise.all(Array.from(this.fileIndicators.entries()).map(async ([fileName, labels]) => {
			await this.addLabelIfApplicable(folderPath, fileName, labels);
		}));
	}

	async addLabelIfApplicable(folderPath: string, fileName: string, labels: string[]) {
		const filePath = path.join(folderPath, fileName);
		const fileUri = vscode.Uri.file(filePath);
		try {
			await vscode.workspace.fs.stat(fileUri);
			labels.forEach((label) => this._labels.push(label));
			const contentIndicator = this.contentIndicators.get(fileName);
			if (contentIndicator !== undefined) {
				const fileContent = await vscode.workspace.fs.readFile(fileUri);
				contentIndicator(new TextDecoder().decode(fileContent)).forEach((label) =>
					this._labels.push(label)
				);
			}
		} catch (error) {
		}
	}

	initializeIndicators() {
		this.addFileIndicator('package.json', 'javascript', 'npm');
		this.addFileIndicator('tsconfig.json', 'typescript');
		this.addFileIndicator('pom.xml', 'java', 'maven');
		this.addFileIndicator('build.gradle', 'java', 'gradle');
		this.addFileIndicator('requirements.txt', 'python', 'pip');
		this.addFileIndicator('Pipfile', 'python', 'pip');
		this.addFileIndicator('Cargo.toml', 'rust', 'cargo');
		this.addFileIndicator('go.mod', 'go', 'go.mod');
		this.addFileIndicator('pubspec.yaml', 'dart', 'pub');
		this.addFileIndicator('build.sbt', 'scala', 'sbt');
		this.addFileIndicator('build.boot', 'clojure', 'boot');
		this.addFileIndicator('project.clj', 'clojure', 'lein');
		this.addFileIndicator('mix.exs', 'elixir', 'mix');
		this.addFileIndicator('composer.json', 'php', 'composer');
		this.addFileIndicator('Gemfile', 'ruby', 'bundler');
		this.addFileIndicator('build.xml', 'java', 'ant');
		this.addFileIndicator('build.gradle.kts', 'java', 'gradle');
		this.addFileIndicator('yarn.lock', 'yarn');
		this.addContentIndicator(
			'package.json',
			this.collectPackageJsonIndicators,
		);
	}

	addFileIndicator(fileName: string, ...labels: string[]) {
		this.fileIndicators.set(fileName, labels);
	}

	addContentIndicator(fileName: string, indicatorFunction: (fileContent: string) => string[]) {
		this.contentIndicators.set(fileName, indicatorFunction);
	}

	collectPackageJsonIndicators(fileContent: string): string[] {
		const labels = [];
		const parsedContent = JSON.parse(fileContent);
		const dependencies = parsedContent.dependencies;
		const devDependencies = parsedContent.devDependencies;
		if (dependencies) {
			if (dependencies['@angular/core']) {
				labels.push('angular');
			}
			if (dependencies.react) {
				labels.push('react');
			}
			if (dependencies.vue) {
				labels.push('vue');
			}
		}
		if (devDependencies && devDependencies.typescript) {
			labels.push('typescript');
		}
		const engines = parsedContent.engines;
		if (engines) {
			if (engines.node) {
				labels.push('node');
			}
			if (engines.vscode) {
				labels.push('vscode extension');
			}
		}
		return labels;
	}
}
