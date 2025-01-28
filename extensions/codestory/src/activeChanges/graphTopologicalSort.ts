/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This graph helps us find disconnected components and to also do topological
// sorting on the nodes so we can create order out of chaos
export class Graph {
	adjacencyList: Record<string, string[]>;
	reverseAdjacencyList: Record<string, string[]>;

	constructor() {
		this.adjacencyList = {};
		this.reverseAdjacencyList = {};
	}

	addNode(node: string) {
		if (!this.adjacencyList[node]) {
			this.adjacencyList[node] = [];
		}
		if (!this.reverseAdjacencyList[node]) {
			this.reverseAdjacencyList[node] = [];
		}
	}

	addEdge(node1: string, node2: string) {
		this.adjacencyList[node1].push(node2);
		this.reverseAdjacencyList[node2].push(node1);
	}
}

export class SCCFinder {
	index: number;
	stack: string[];
	indices: Record<string, number>;
	lowLink: Record<string, number>;
	onStack: Record<string, boolean>;
	sccs: string[][];

	constructor(private graph: Graph) {
		this.index = 0;
		this.stack = [];
		this.indices = {};
		this.lowLink = {};
		this.onStack = {};
		this.sccs = [];

		for (const node in graph.adjacencyList) {
			if (this.indices[node] === undefined) {
				this.strongConnect(node);
			}
		}
	}

	strongConnect(node: string) {
		this.indices[node] = this.lowLink[node] = this.index++;
		this.stack.push(node);
		this.onStack[node] = true;

		for (const neighbor of this.graph.adjacencyList[node]) {
			if (this.indices[neighbor] === undefined) {
				this.strongConnect(neighbor);
				this.lowLink[node] = Math.min(this.lowLink[node], this.lowLink[neighbor]);
			} else if (this.onStack[neighbor]) {
				this.lowLink[node] = Math.min(this.lowLink[node], this.indices[neighbor]);
			}
		}

		if (this.lowLink[node] === this.indices[node]) {
			const scc = [];
			let w: string;
			do {
				w = this.stack.pop()!;
				this.onStack[w] = false;
				scc.push(w);
			} while (w !== node);
			this.sccs.push(scc);
		}
	}
}

export class WCCFinder {
	visited: Record<string, boolean>;
	wccs: string[][];

	constructor(private graph: Graph) {
		this.visited = {};
		this.wccs = [];

		for (const node in graph.adjacencyList) {
			if (!this.visited[node]) {
				const wcc: string[] = [];
				this.dfs(node, wcc);
				this.wccs.push(wcc);
			}
		}
	}

	dfs(node: string, wcc: string[]) {
		wcc.push(node);
		this.visited[node] = true;

		for (const neighbor of this.graph.adjacencyList[node]) {
			if (!this.visited[neighbor]) {
				this.dfs(neighbor, wcc);
			}
		}

		for (const neighbor of this.graph.reverseAdjacencyList[node]) {
			if (!this.visited[neighbor]) {
				this.dfs(neighbor, wcc);
			}
		}
	}
}

// This is a DFS based topological sort.
export function topoSort(
	graph: Record<string, string[]>,
): string[] {
	const visited: Record<string, boolean> = {};
	const stack: string[] = [];

	for (const node in graph) {
		if (!visited[node]) {
			topoSortUtil(graph, node, visited, stack);
		}
	}

	return stack.reverse();
}

// Utility function used by topoSort
export function topoSortUtil(
	graph: Record<string, string[]>,
	node: string,
	visited: Record<string, boolean>,
	stack: string[],
) {
	visited[node] = true;

	for (const neighbor of graph[node]) {
		if (!visited[neighbor]) {
			topoSortUtil(graph, neighbor, visited, stack);
		}
	}

	stack.push(node);
}


export class GraphDFS {
	private vertices: number;
	private adj: string[][];
	private map: Map<string, number>;
	private keys: string[];

	constructor(vertices: string[]) {
		this.vertices = vertices.length;
		this.adj = new Array(this.vertices).fill(0).map(() => new Array());
		this.map = new Map();
		this.keys = vertices;

		// Map string vertices to integers
		vertices.forEach((vertex, index) => {
			this.map.set(vertex, index);
		});
	}

	addEdge(v: string, w: string): void {
		const vNode = this.map.get(v);
		const wNode = this.map.get(w);
		if (vNode === undefined || wNode === undefined) {
			return;
		}
		this.adj[vNode].push(w);
		this.adj[wNode].push(v); // Since it's an undirected graph
	}

	addNode(v: string): void {
		// Only add the node if it's not already present
		if (!this.map.has(v)) {
			this.map.set(v, this.vertices);
			this.keys.push(v);
			this.adj.push([]);
			this.vertices++;
		}
	}

	dfsUtil(v: string, visited: boolean[], component: string[]): void {
		const index = this.map.get(v);
		// Check if index exists
		if (index !== undefined) {
			// Mark the current node as visited and add to component
			visited[index] = true;
			component.push(v);

			// Recur for all the vertices adjacent to this vertex
			for (let i = 0; i < this.adj[index].length; ++i) {
				const neighborIndex = this.map.get(this.adj[index][i]);
				if (neighborIndex !== undefined && !visited[neighborIndex]) {
					this.dfsUtil(this.adj[index][i], visited, component);
				}
			}
		}
	}

	connectedComponents(): string[][] {
		const visited = new Array(this.vertices).fill(false);
		const components: string[][] = [];

		for (let v = 0; v < this.vertices; ++v) {
			if (!visited[v]) {
				const component: string[] = [];
				// get all reachable vertices from v
				this.dfsUtil(this.keys[v], visited, component);
				components.push(component);
			}
		}

		return components;
	}
}



// let g = new Graph();
// g.addNode('A');
// g.addNode('B');
// g.addNode('C');
// g.addNode('D');
// g.addNode('E');
// g.addNode('F');
// g.addNode('G');
// g.addNode('H');

// g.addEdge('A', 'B');
// g.addEdge('A', 'C');
// g.addEdge('B', 'D');
// g.addEdge('E', 'D');
// g.addEdge('F', 'G');
// g.addEdge('G', 'H');


// const sccFinder = new SCCFinder(g);
// console.log(sccFinder.sccs);
// const wccFinder = new WCCFinder(g);
// console.log(wccFinder.wccs);

// let componentGraph: Record<string, string[]> = {};

// wccFinder.wccs.forEach((component, i) => {
//     let componentGraph: Record<string, string[]> = {};

//     for (let node of component) {
//         componentGraph[node] = g.adjacencyList[node].filter(neighbor => component.includes(neighbor));
//     }

//     let sortedNodes = topoSort(componentGraph);
//     console.log(`Component ${i + 1}:`, sortedNodes);
// });
