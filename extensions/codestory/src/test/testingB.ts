/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { A } from './testingA';

export class B {
	private _inner: A;

	constructor() {
		this._inner = new A();
		console.log(this._inner.doA());
	}

	doSomething() {
		return 'A';
	}

	doInteresting() {
		return 'B';
	}
}
