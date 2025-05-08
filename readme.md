# Directed Acyclic Graph Layout

This light weight module provides a graph object which can be used to calculate the positions of its nodes,
minimizing total edge crossings or total edge distance. It does not use any third-part dependencies.
The algorithm is permutation-based and uses discrete layers. The execution time can be indirectly controlled via threshold parameters.

## How to use

Assumptions:
- Your source graph nodes are or can be transformed to a list of objects which have a unique, numeric or string ID property
- Your source edges are or can be transformed to pairs of node IDs

### Step 1: Create a new Graph
You can pass one optional parameter which corresponds to the name of the node ID property:
```
const graph = new Graph();       // default ID property name is "id"
const graph = new Graph("uuid");  // use uuid field instead
```

### Step 2: Populate your graph with nodes and edges from your model
**The passed objects will not be mutated.**
In the example, I'm assuming the model objects are in an array "taskList".
Each task object has an array property nextTasksId which contains the IDs of all tasks connected to it.
Note that no layout related information is required. The tasks in taskList contain pure data.

```
taskList.forEach(graph.addNode);
taskList.forEach((element) =>
   element.nextTasksId.forEach((s) => graph.addEdge(element.id, s))
);
```

### Step 3: Calculate the layout
The layout is calculated with following command. The method takes an optional configuration object, whose properties are also optional.
```
graph.layout();
```
or
```
const lastGraph = useRef(null);
...
// this is probably in a useEffect hook
graph.layout({ previous: lastGraph.current });
lastGraph.current = graph;
```

### Step 4: Using the results
After the calculation, the nodes are wrapped into VirtualNodes providing layout properties.
Additionally, new nodes have been created which represent placeholders that block space for edges.
It is up to you whether you use these as focus points for your edges or simply connect the original nodes directly.

Layout properties can be fetched from VirtualNodes with following methods:
- getData: This is a reference to the wrapped original node objects. null for virtual nodes
- getFlow: 0-based layer index in flow direction. Transform this to an x or y position manually.
- getOrth: this is a number in (0,1)-range, otrthogonal to the flow. 0.5 means the node is in the center. Transform this to an x or y position manually.
- getGroupIndex: 0-based group index. This is only relevant in case your nodes are not connected (for example if the graph is WIP).
Transform this to an x or y position manually, if you support unconnected nodes.
- isVirtual: true means the node was generated during layouting, false means this is a node that was originally added to the graph.
- getLayoutId: a unique, numeric ID that was assigned during layouting. It allows you to index both real and virtual nodes.

The results can be accessed with following Graph methods:
- getNodes: returns an object which contains all passed IDs as keys and the corresponding nodes as values.
  The original node objects are wrapped into VirtualNodes. Use this if you don't care about virtual nodes.
- getEdges: returns an object which contains all passed predecessor IDs as keys and all successor IDs are part of an array in the value.
  This also ignores virtual nodes.
- getVirtualNodes: returns an array of all nodes, including the virtual ones. You can use the virtual nodes as anchor points for multilayer edges,
- getVirtualEdges: returns an array of all virtual edges which contain references to the nodes they connect (virtual and real ones).
- getMaxWidth: returns an array containing the maximum width (parallel nodes) of the groups of connected nodes
- getMaxLength: returns an array containing the maximum length in flow direction of the groups of connected nodes
- getGroupCount: returns the number of groups of connected nodes
- getMetricsValue: returns the number of crosssings or the total distance. This can be used to compare the outcomes of several layout() iterations with different config parameters.

VirtualEdge offers following access methods:
- isCyclic: returns whether this edge has been excluded from processing because it is introducing a cycle to the graph. Cyclic edges are added back after the processing.
- getPredecessor: returns the VirtualNode predecessor reference
- getSuccessor: returns the VirtualNode successor reference
- getFrom: returns the VirtualNode predecessor reference wrapped in an array, if the node is real, otherwise it returns all real predecessors that the edge eventually leads to 
- getTo: returns the VirtualNode successor reference wrapped in an array, if the node is real, otherwise it returns all real successors that the edge eventually leads to 

## Configuration parameters
- previous = null : You can skip repetitive calculations by passing another graph with the same node and edge structure.
  I recommend saving used graphs representing the same object in a ref and always passing it to layout().
  It will copy the old model and patch it with the new node data (overwriting the old reference).
  If the graph structure has changed, it will be detected and the calculation will be run.
  Node data changes which are not affecting the structure will not trigger the calculation.
  Replacing the node data object with an updated version though a React state update is also a NOOP. 
- metrics = "crossings": There are 2 options deciding what should be minimized during layouting, both referring to edges: "crossing", "distance"
  "crossings" is a bit slower than "distance" but also looks a bit better IMO
- alignNodes = "start": There are 4 options: "start", "center-start", "center-end", "end"
  This parameter decides how to position nodes in flow direction on edges that span more than one layer.
  Center offers 2 options because the layers are discrete. For odd edge lengths, both options will behave in the same manner.
- mergeVirtualNodes = "start": There are 3 options: "start", "end", null. Every edge which is longer than one layer will create a placeholder node on each layer it passes.
  When this option is activated, it will try to reduce the number of virtual nodes by merging those with the same predecessors or successors into one.
  "start", "end" are both active options, but "start" priotitizes merging nodes with the same predecessors and "end" with the same successors. 
  Also, "start" sweeps into flow direction, and "end" against it.
- thresholdEvaluate = 500000: For big graphs with a lot of cross-edges, there is a tradeoff between performance and quality.
  The algorithm is permutation based and also tries to calculate multiple layers in one run.
  If you have n layers with widths w_1...w_n, the total possible amount of permutations is the product of w_i! with i from 1 to n.
  This threshold forces the evaluation as soon as the product of all layers in the frame exceeds it.
  Only a fraction of the theoretically possible permutations are actually calculated, the rest is skipped as soon as it is obvious they cannot improve the result.
  The graph is split when the number of actually evaluated permutations threatens to exceed the limit (when this happens, the ongoing evaluation is simply cancelled). 
  Until then, the algorithm tries to add as many layers to the current frame as possible.
  The parameter is able to control the execution time effectively. It can only grow **linear** to the threshold and the length of the graph in flow direction, 
  because the counter is reset after each evaluation. The default value should be small enough for real-time execution for medium-sized graphs (~50 nodes).
- thresholdLayer = 21000: It is not enough to have a limit on the amount of layers that can be processed in one run.
  The amount of permutations increases extremely quickly and even one large layer might be enough to exhaust any reasonable limit.
  This is why it can be split into multiple overlapping parts if the amount of permutations exceeds the threshold.
  The default value allows to swap 10 parallel nodes in 4 adjacent, overlapping groups of 7 (7! times 4 = 20160). 
- debug = false : If true, this prints some debug output like time spent and metrics

## Limitations
The nodes don't have to be fully connected (in this case, they will be split into connected groups - if you don't have any validation against that, use groupIndex).
If the graph contains cycles, layouting is performed without cyclic edges. They are added back afterwards to the model (see isCyclic method). 
The threshold parameters prevent any scaling issues. It is recommended to set thresholdEvaluate <= 10 million, and thresholdLayer <= 100000.
In any case, thresholdLayer cannot be smaller than thresholdEvaluate, also the product of thresholdLayer and thresholdEvaluate cannot be set above Number.MAX_SAFE_INTEGER.