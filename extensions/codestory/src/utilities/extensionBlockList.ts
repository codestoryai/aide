/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
export const EXCLUDED_EXTENSIONS = [
	// graphics
	'.png', '.jpg', '.jpeg', '.ico', '.bmp', '.bpg', '.eps', '.pcx', '.ppm', '.tga', '.tiff', '.wmf', '.xpm',
	'.svg', '.riv',
	// fonts
	'.ttf', '.woff2', '.fnt', '.fon', '.otf',
	// documents
	'.pdf', '.ps', '.doc', '.dot', '.docx', '.dotx', '.xls', '.xlsx', '.xlt', '.odt', '.ott', '.ods', '.ots', '.dvi', '.pcl',
	// media
	'.mp3', '.ogg', '.ac3', '.aac', '.mod', '.mp4', '.mkv', '.avi', '.m4v', '.mov', '.flv',
	// compiled
	'.jar', '.pyc', '.war', '.ear',
	// compression
	'.tar', '.gz', '.bz2', '.xz', '.7z', '.bin', '.apk', '.deb', '.rpm',
	// executable
	'.com', '.exe', '.out', '.coff', '.obj', '.dll', '.app', '.class',
	// misc.
	'.log', '.wad', '.bsp', '.bak', '.sav', '.dat', '.lock',
];


export const isExcludedExtension = (extension: string): boolean => {
	if (EXCLUDED_EXTENSIONS.includes(extension)) {
		return true;
	}
	return false;
};
