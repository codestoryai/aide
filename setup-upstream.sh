#!/bin/sh

# Check if upstream remote exists
if ! git remote | grep -q 'upstream'; then
	git remote add upstream git@github.com:microsoft/vscode.git
	git remote set-url --push upstream DISABLE
	echo "Upstream remote added!"
else
	echo "Upstream remote already exists."
fi
