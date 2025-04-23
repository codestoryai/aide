/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Here I want to get the remote url of the current repo
// and also the hash we are on
// import logger from '../logger';
import { execCommand, runCommandAsync } from '../utilities/commandRunner';
import logger from '../logger';
import { SIDECAR_CLIENT } from '../extension';

export const getGitRepoName = async (workingDirectory: string): Promise<string> => {
	// Log the pwd here
	try {
		// const currentWorkingDirectory = realpathSync(resolve('.'));
		// logger.info('codestory');
		// logger.info(currentWorkingDirectory);
		const { stdout } = await runCommandAsync(workingDirectory, 'git', [
			'rev-parse',
			'--show-toplevel',
		]);
		const tolLevelName = stdout.trim().split('/').pop() || '';
		const data = await runCommandAsync(workingDirectory, 'basename', [tolLevelName]);
		return data.stdout.trim();
	} catch (error) {
		return 'codestory-error-no-git';
	}
};

export const getGitRemoteUrl = async (workingDirectory: string): Promise<string> => {
	try {
		const { stdout } = await runCommandAsync(workingDirectory, 'git', [
			'remote',
			'get-url',
			'origin',
		]);
		return stdout.trim();
	} catch (error) {
		return 'codestory-error-no-git';
	}
};

export const getGitCurrentHash = async (workingDirectory: string): Promise<string> => {
	try {
		const { stdout } = await runCommandAsync(workingDirectory, 'git', ['rev-parse', 'HEAD']);
		logger.info('Whats the stdout');
		logger.info(stdout);
		return stdout.trim();
	} catch (error) {
		return 'codestory-error-no-git';
	}
};

export const getFilesTrackedInWorkingDirectory = async (workingDirectory: string): Promise<string[]> => {
	try {
		const { stdout } = await runCommandAsync(workingDirectory, 'git', ['ls-files']);
		const fileList = stdout.trim().split('\n').filter((x) => x.length > 0);
		// now we join the working directory with the file name
		const filesWithWorkingDirectory = fileList.map((file) => {
			return `${workingDirectory}/${file}`;
		});
		return filesWithWorkingDirectory;
	} catch (error) {
		return [];
	}
};

// Returns the files which were touched in the last 2 weeks
export const getFilesInLastCommit = async (workingDirectory: string): Promise<string[]> => {
	// command we have to run is the following:
	// https://chat.openai.com/share/d516b75e-1567-4ce2-b96f-80ba6272adf0
	const stdout = await execCommand(
		'git log --pretty="%H" --since="2 weeks ago" | while read commit_hash; do git diff-tree --no-commit-id --name-only -r $commit_hash; done | sort | uniq -c | awk -v prefix="$(git rev-parse --show-toplevel)/" \'{ print prefix $2, $1 }\' | sort -k2 -rn',
		workingDirectory,
	);
	// Now we want to parse this output out, its always in the form of
	// {file_path} {num_tries} and the file path here is relative to the working
	// directory
	const splitLines = stdout.split('\n');
	const finalFileList: string[] = [];
	for (let index = 0; index < splitLines.length; index++) {
		const lineInfo = splitLines[index].trim();
		if (lineInfo.length === 0) {
			continue;
		}
		// split it by the space
		const splitLineInfo = lineInfo.split(' ');
		if (splitLineInfo.length !== 2) {
			continue;
		}
		const filePath = splitLineInfo[0];
		finalFileList.push(filePath);
	}
	return finalFileList;
};

export const getStagedChanges = async (workingDirectory: string): Promise<string> => {
    try {
        const { stdout } = await runCommandAsync(workingDirectory, 'git', ['diff', '--staged']);
        return stdout.trim();
    } catch (error) {
        return '';
    }
};

export const getRecentCommitMessages = async (workingDirectory: string, count: number = 10): Promise<string[]> => {
    try {
        const { stdout } = await runCommandAsync(workingDirectory, 'git', ['log', '-n', count.toString(), '--pretty=format:%s']);
        return stdout.trim().split('\n');
    } catch (error) {
        return [];
    }
};

export const analyzeCommitStyle = async (workingDirectory: string): Promise<{
    useConventional: boolean;
    commonPrefixes: string[];
}> => {
    const recentMessages = await getRecentCommitMessages(workingDirectory);
    if (recentMessages.length === 0) {
        return { useConventional: true, commonPrefixes: [] };
    }

    // Check for conventional commit format
    const conventionalPattern = /^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?: .+/;
    const conventionalCount = recentMessages.filter(msg => conventionalPattern.test(msg)).length;
    const useConventional = conventionalCount > recentMessages.length * 0.3;

    // Extract common prefixes if not using conventional format
    const commonPrefixes = !useConventional ? recentMessages
        .map(msg => msg.split(':')[0]?.trim())
        .filter(prefix => prefix && prefix.length < 20)
        .reduce((acc: { [key: string]: number }, prefix) => {
            acc[prefix] = (acc[prefix] || 0) + 1;
            return acc;
        }, {}) : {};

    return {
        useConventional,
        commonPrefixes: Object.entries(commonPrefixes)
            .filter(([_, count]) => count > 1)
            .map(([prefix]) => prefix)
    };
};

export const generateCommitMessage = async (workingDirectory: string): Promise<string> => {
    try {
        const stagedDiff = await getStagedChanges(workingDirectory);
        if (!stagedDiff) {
            return 'No staged changes found';
        }

        const { stdout: stagedFiles } = await runCommandAsync(workingDirectory, 'git', ['diff', '--staged', '--name-only']);
        const files = stagedFiles.trim().split('\n');

        // Analyze commit style
        const { useConventional, commonPrefixes } = await analyzeCommitStyle(workingDirectory);

        // Prepare prompt based on commit style
        let prompt = `Generate a concise commit message for the following changes:\n\nFiles changed:\n${files.join('\n')}\n\nChanges:\n${stagedDiff}\n\n`;
        
        if (useConventional) {
            prompt += `The commit message should follow the conventional commits format: type(scope): description\nwhere type is one of: feat, fix, docs, style, refactor, test, chore\n`;
        } else if (commonPrefixes.length > 0) {
            prompt += `The commit message should be similar in style to these prefixes commonly used in this repository: ${commonPrefixes.join(', ')}\n`;
        } else {
            prompt += `Keep the message concise and descriptive, focusing on what changed and why.\n`;
        }

        if (SIDECAR_CLIENT) {
            const response = await SIDECAR_CLIENT.getCompletion(prompt);
            if (response && response.trim()) {
                return response.trim();
            }
        }
        
        // Fallback message following the detected style
        const fileCount = files.length;
        const fileList = files.slice(0, 3).join(', ') + (fileCount > 3 ? ` and ${fileCount - 3} more files` : '');
        return useConventional ? 
            `feat: update ${fileList}` : 
            (commonPrefixes.length > 0 ? 
                `${commonPrefixes[0]}: ${fileList}` : 
                `Update ${fileList}`);
    } catch (error) {
        logger.error('Error generating commit message:', error);
        return 'Error generating commit message';
    }
};