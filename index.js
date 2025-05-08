const validate = (thresholdEvaluate, thresholdLayer, alignNodes, metrics) => {
  if (isNaN(thresholdEvaluate) || thresholdEvaluate < 1) {
    throw new Error("thresholdEvaluate has to be a positive number");
  }
  if (isNaN(thresholdLayer) || thresholdLayer < 1) {
    throw new Error("thresholdLayer has to be a positive number");
  }
  if (thresholdEvaluate < thresholdLayer) {
    throw new Error("thresholdEvaluate has to be >= thresholdLayer");
  }
  if (thresholdEvaluate * thresholdLayer > Number.MAX_SAFE_INTEGER) {
    throw new Error(
      "thresholdEvaluate * thresholdLayer has to be < Number.MAX_SAFE_INTEGER"
    );
  }
  const alignNodeValues = ["start", "center-start", "center-end", "end"];
  if (!alignNodeValues.includes(alignNodes)) {
    throw new Error(
      "alignNodes has to be one of following values: " + alignNodeValues
    );
  }
  const metricsValues = ["crossings", "distance"];
  if (!metricsValues.includes(metrics)) {
    throw new Error(
      "metrics has to be one of following values: " + metricsValues
    );
  }
};

const removeCycles = (nodes) => {
  const unmarkedNodes = [...nodes];
  let cyclicEdges = [];

  while (unmarkedNodes.length > 0) {
    const newMarkedNodes = unmarkedNodes.filter(
      (n) =>
        !n.predecessors.some((s) => unmarkedNodes.includes(s)) ||
        !n.successors.some((s) => unmarkedNodes.includes(s))
    );

    if (newMarkedNodes.length === 0) {
      const possibleCyclicEdges = nodes
        .filter((node) => unmarkedNodes.includes(node))
        .flatMap((node) =>
          node.predecessors
            .filter((p) => unmarkedNodes.includes(p))
            .map((p) => [p, node])
        );

      cyclicEdges = [...cyclicEdges, possibleCyclicEdges[0]];
      possibleCyclicEdges[0][0].removeSuccessor(possibleCyclicEdges[0][1]);
    } else {
      for (const newMarkedNode of newMarkedNodes) {
        unmarkedNodes.splice(unmarkedNodes.indexOf(newMarkedNode), 1);
      }
    }
  }

  return cyclicEdges;
};

const groupNodes = (nodes) => {
  let nodeGroupIndex = 0;
  const nodeGroups = [];

  while (nodes.length > 0) {
    nodeGroups[nodeGroupIndex] = [];
    const nodeQueue = [nodes[0]];

    while (nodeQueue.length > 0) {
      let currentNode = nodeQueue.shift();

      if (currentNode.groupIndex === undefined) {
        currentNode.groupIndex = nodeGroupIndex;
        nodeGroups[nodeGroupIndex] = [
          ...nodeGroups[nodeGroupIndex],
          currentNode,
        ];
        nodeQueue.push(...currentNode.predecessors, ...currentNode.successors);
      }
    }

    nodeGroupIndex++;
    nodes = nodes.filter((node) => node.groupIndex === undefined);
  }

  return nodeGroups;
};

const topoSortNodes = (nodes, relProp, orderProp) => {
  let flow = 0;
  const unmarkedNodes = [...nodes];
  while (unmarkedNodes.length > 0) {
    const newMarkedNodes = unmarkedNodes.filter(
      (n) => !n[relProp].some((p) => unmarkedNodes.includes(p))
    );

    if (newMarkedNodes.length === 0) {
      throw new Error("Cycle detected in graph during flow calculation!");
    } else {
      for (const newMarkedNode of newMarkedNodes) {
        newMarkedNode[orderProp] = flow;
        unmarkedNodes.splice(unmarkedNodes.indexOf(newMarkedNode), 1);
      }
    }
    flow++;
  }

  return flow;
};

const calculateFlow = (nodes, alignNodes) => {
  let maxFlow = 0;

  if (["start", "center-start", "center-end"].includes(alignNodes)) {
    maxFlow = topoSortNodes(nodes, "predecessors", "flowTop");
  }

  if (["end", "center-end", "center-start"].includes(alignNodes)) {
    maxFlow = topoSortNodes(nodes, "successors", "flowBottom");
  }

  for (const node of nodes) {
    switch (alignNodes) {
      case "start":
        node.flow = node.flowTop;
        delete node.flowTop;
        break;
      case "end":
        node.flow = maxFlow - 1 - node.flowBottom;
        delete node.flowBottom;
        break;
      case "center-start":
        node.flow = Math.floor(
          (node.flowTop + maxFlow - 1 - node.flowBottom) / 2
        );
        delete node.flowTop;
        delete node.flowBottom;
        break;
      case "center-end":
        node.flow = Math.ceil(
          (node.flowTop + maxFlow - 1 - node.flowBottom) / 2
        );
        delete node.flowTop;
        delete node.flowBottom;
        break;
      default:
    }
  }

  return maxFlow;
};

const addVirtualNodes = (nodes, maxLength) => {
  const layeredNodes = Array.from(Array(maxLength), () => []);
  const layeredEdges = Array.from(Array(maxLength - 1), () => []);

  for (const node of nodes) {
    const nodeFlow = node.flow;
    layeredNodes[nodeFlow] = [...layeredNodes[nodeFlow], node];

    for (const successor of node.successors) {
      let predecessor = node;

      for (let i = nodeFlow + 1; i < successor.flow; i++) {
        const intermediate = new VirtualNode(null, i);
        intermediate.realPredecessors = [node];
        intermediate.realSuccessors = [successor];
        intermediate.groupIndex = node.groupIndex;
        layeredNodes[i] = [...layeredNodes[i], intermediate];
        layeredEdges[predecessor.flow] = [
          ...layeredEdges[predecessor.flow],
          [predecessor, intermediate],
        ];

        predecessor = intermediate;
      }

      layeredEdges[predecessor.flow] = [
        ...layeredEdges[predecessor.flow],
        [predecessor, successor],
      ];
    }
  }

  return [layeredNodes, layeredEdges];
};

const nodeRelEquals = (a1, a2) =>
  a1.length === a2.length && a1.every((item) => a2.includes(item));
const filterDuplicates = (v, i, a) => a.indexOf(v) === i;

const getNextMergableVirtualNodeGroup = (layeredNodes, pre) => {
  const relProp = pre ? "realPredecessors" : "realSuccessors";
  const maxLength = layeredNodes.length;
  for (let i = 0; i < maxLength; i++) {
    const virtualNodes = layeredNodes[pre ? i : maxLength - i - 1].filter(
      (node) => node.virtual
    );
    for (const node of virtualNodes) {
      const group = virtualNodes.filter(
        (otherNode) =>
          otherNode !== node && nodeRelEquals(node[relProp], otherNode[relProp])
      );

      if (group.length > 0) {
        return { node, group, pre };
      }
    }
  }

  return null;
};

const mergeNextVirtualNodeGroup = (
  layeredNodes,
  layeredEdges,
  mergeVirtualNodes
) => {
  let res = getNextMergableVirtualNodeGroup(
    layeredNodes,
    "start" === mergeVirtualNodes
  );

  if (res === null) {
    res = getNextMergableVirtualNodeGroup(
      layeredNodes,
      "end" === mergeVirtualNodes
    );
  }

  if (res === null) {
    return false;
  }

  const { node, group, pre } = res;
  const flow = node.flow;

  for (const replacedNode of group) {
    layeredNodes[flow] = layeredNodes[flow].filter(
      (item) => item !== replacedNode
    );

    const newEdges = pre
      ? layeredEdges[flow]
          .filter((edge) => edge[0] === replacedNode)
          .map((edge) => [node, edge[1]])
      : layeredEdges[flow - 1]
          .filter((edge) => edge[1] === replacedNode)
          .map((edge) => [edge[0], node]);
    layeredEdges[flow - 1] = layeredEdges[flow - 1].filter(
      (edge) => edge[1] !== replacedNode
    );
    layeredEdges[flow] = layeredEdges[flow].filter(
      (edge) => edge[0] !== replacedNode
    );

    if (pre) {
      node.realSuccessors = [
        ...node.realSuccessors,
        ...replacedNode.realSuccessors,
      ].filter(filterDuplicates);

      layeredEdges[flow] = [...layeredEdges[flow], ...newEdges];
    } else {
      node.realPredecessors = [
        ...node.realPredecessors,
        ...replacedNode.realPredecessors,
      ].filter(filterDuplicates);

      layeredEdges[flow - 1] = [...layeredEdges[flow - 1], ...newEdges];
    }
  }

  return mergeVirtualNodes;
};

const predecessorAverage = (node) => {
  const predecessors = node.predecessors;
  const l = predecessors.length;
  return l === 0
    ? 0.5
    : predecessors.reduce((sum, obj) => sum + obj.orth, 0) / l;
};

const predecessorAverageSort = (n1, n2) => {
  const av = predecessorAverage(n1);
  const diff = av - predecessorAverage(n2);
  return diff === 0
    ? (0.5 - av) *
        (n1.predecessors.length +
          n1.successors.length -
          n2.predecessors.length -
          n2.successors.length)
    : diff;
};

const totalCrossings = (edges, crossings) => {
  const vl = edges.length;
  let res = 0;

  for (let i = 0; res < crossings && i < vl; i++) {
    const [{ orth: e1From }, { orth: e1To }] = edges[i];

    for (let j = i + 1; res < crossings && j < vl; j++) {
      const [{ orth: e2From }, { orth: e2To }] = edges[j];

      if ((e1From - e2From) * (e1To - e2To) < 0) {
        res++;
      }
    }
  }

  return res;
};

const totalDistance = (edges, distance) => {
  const vl = edges.length;
  let res = 0;

  for (let i = 0; res < distance && i < vl; i++) {
    const [{ orth: edgeFrom }, { orth: edgeTo }] = edges[i];
    res += edgeTo > edgeFrom ? edgeTo - edgeFrom : edgeFrom - edgeTo;
  }

  return res;
};

const factorialLimited = (n, threshold) => {
  let res = 1;

  for (let i = 2; i <= n; i++) {
    res *= i;

    if (res > threshold) {
      let splitRes = res;
      let j = i;

      while (splitRes > threshold && j > 1) {
        res /= j;
        j--;
        splitRes = res * (n - j + 1);
      }

      return j === 1 ? [1, 1] : [splitRes, j];
    }
  }

  return [res, n];
};

const nextPermutation = (layer, permState, permShift) => {
  const n = permState.length;

  for (let i = 1; i < n; i++) {
    const p = permState[i];
    if (p < i) {
      const oi = i % 2 === 0 ? permShift : p + permShift;
      const si = i + permShift;
      const tmp = layer[si].orth;
      layer[si].orth = layer[oi].orth;
      layer[oi].orth = tmp;
      permState[i]++;
      return permShift;
    } else {
      permState[i] = 0;
    }
  }

  const width = layer.length;
  const sw = n + permShift;
  for (let i = permShift; i < sw; i++) {
    layer[i].orth = (i + 0.5) / width;
  }

  return (permShift + 1) % (width - n + 1);
};

const findBestPermutation = (
  nodes,
  edges,
  metrics,
  permsLayer,
  permWidthsLayer,
  start,
  end,
  symmetry,
  thresholdEvaluate,
  metricsMethod,
  debug
) => {
  const time = Date.now();
  let bestMetrics = 0,
    permsExecuted = 1;
  const metricsFunction =
    metricsMethod === "crossings" ? totalCrossings : totalDistance;

  if (start === end || (start === end - 1 && symmetry === true)) {
    if (debug) {
      console.log(
        "findBestPermutation(start=%i end=%i symmetry=%o) -> %d permutations, %d %s in %d ms",
        start,
        end,
        symmetry,
        permsExecuted,
        bestMetrics,
        metricsMethod,
        Date.now() - time
      );
    }
    return 1;
  }

  const calculatedLayers = end - start;
  const usedNodes = nodes.slice(start, end);
  const usedEdges = edges.slice(start - 1, end - 1);
  const usedMetrics = Array(calculatedLayers);
  const permState = Array(calculatedLayers);
  const permCounter = Array(calculatedLayers);
  const permCounterOverflow = Array(calculatedLayers);
  const permShift = Array(calculatedLayers);
  const bestResult = Array(calculatedLayers);
  let totalPerms = 1;

  for (let i = 0; i < calculatedLayers; i++) {
    const l = i + start;
    usedMetrics[i] =
      symmetry === true && i === 0
        ? 0
        : metricsFunction(usedEdges[i], Number.MAX_VALUE);
    metrics[l] = usedMetrics[i];
    bestMetrics += usedMetrics[i];
    bestResult[i] = usedNodes[i].map((item) => item.orth);
    permCounter[i] = 0;
    totalPerms *= permsLayer[l];
    permCounterOverflow[i] = totalPerms;
    permShift[i] = 0;
    permState[i] = Array(permWidthsLayer[l]).fill(0);
  }

  if (bestMetrics === 0) {
    if (debug) {
      console.log(
        "findBestPermutation(start=%i end=%i symmetry=%o) -> %d of %d permutations, %d %s in %d ms",
        start,
        end,
        symmetry,
        permsExecuted,
        totalPerms,
        bestMetrics,
        metricsMethod,
        Date.now() - time
      );
    }

    return permsExecuted;
  }

  for (let i = 0; i < calculatedLayers; i++) {
    permCounterOverflow[i] = totalPerms / permCounterOverflow[i];
  }

  for (
    let p = 1, pInc = 1;
    permsExecuted < thresholdEvaluate && p < totalPerms;
    p += pInc, permsExecuted++
  ) {
    let metricsLeft = bestMetrics;
    let currentPermCounterOverflow = 1;

    for (let i = 0; 0 < metricsLeft && i < calculatedLayers; i++) {
      currentPermCounterOverflow = permCounterOverflow[i];

      if (p % currentPermCounterOverflow === 0) {
        permCounter[i]++;
        const nodeLayer = usedNodes[i];
        permShift[i] = nextPermutation(nodeLayer, permState[i], permShift[i]);

        if (symmetry === false || i !== 0) {
          const metricsUsed = metricsFunction(usedEdges[i], metricsLeft);
          usedMetrics[i] = metricsUsed;
          metricsLeft -= metricsUsed;
        } else if (nodeLayer[0].orth > nodeLayer[1].orth) {
          metricsLeft = 0;
        }
      } else {
        metricsLeft -= usedMetrics[i];
      }
    }

    if (metricsLeft > 0) {
      bestMetrics -= metricsLeft;

      for (let i = 0; i < calculatedLayers; i++) {
        metrics[i + start] = usedMetrics[i];
        const nodeLayer = usedNodes[i];
        const bestResultLayer = bestResult[i];
        const width = nodeLayer.length;

        for (let j = 0; j < width; j++) {
          bestResultLayer[j] = nodeLayer[j].orth;
        }
      }

      if (bestMetrics === 0) {
        permsExecuted++;
        break;
      }
    }

    pInc = (totalPerms - p) % currentPermCounterOverflow;
    pInc = pInc === 0 ? currentPermCounterOverflow : pInc;
  }

  for (let i = 0; i < calculatedLayers; i++) {
    const nodeLayer = usedNodes[i];
    const bestResultLayer = bestResult[i];
    const width = nodeLayer.length;

    for (let j = 0; j < width; j++) {
      nodeLayer[j].orth = bestResultLayer[j];
    }
  }

  if (debug) {
    console.log(
      "findBestPermutation(start=%i end=%i symmetry=%o) -> %d of %d permutations, %d %s in %d ms",
      start,
      end,
      symmetry,
      permsExecuted,
      totalPerms,
      bestMetrics,
      metricsMethod,
      Date.now() - time
    );
  }

  return permsExecuted;
};

export class VirtualNode {
  constructor(data, flow) {
    this.data = data;
    this.flow = flow;
    this.orth = undefined;
    this.groupIndex = undefined;
    this.virtual = flow !== undefined;
    this.layoutId = undefined;
    this.predecessors = [];
    this.successors = [];
    this.realPredecessors = [];
    this.realSuccessors = [];
  }

  getData = () => this.data;
  getFlow = () => this.flow;
  getOrth = () => this.orth;
  getGroupIndex = () => this.groupIndex;
  isVirtual = () => this.virtual;
  getLayoutId = () => this.layoutId;

  addSuccessor = (otherNode) => {
    otherNode.predecessors = [...otherNode.predecessors, this];
    this.successors = [...this.successors, otherNode];
  };

  removeSuccessor = (otherNode) => {
    otherNode.predecessors = otherNode.predecessors.filter(
      (item) => item !== this
    );
    this.successors = this.successors.filter((item) => item !== otherNode);
  };
}

export class VirtualEdge {
  constructor([predecessor, successor], cyclic) {
    this.predecessor = predecessor;
    this.successor = successor;
    this.cyclic = cyclic;
  }

  isCyclic = () => this.cyclic;
  getPredecessor = () => this.predecessor;
  getSuccessor = () => this.successor;
  getFrom = () =>
    this.predecessor.virtual
      ? this.predecessor.realPredecessors
      : [this.predecessor];
  getTo = () =>
    this.successor.virtual ? this.successor.realSuccessors : [this.successor];
}

class Graph {
  constructor(nodeIdProp = "id") {
    this.nodeIdProp = nodeIdProp;
    this.nodes = {};
    this.edges = {};
    this.virtualNodes = [];
    this.virtualEdges = [];
    this.maxWidth = [];
    this.maxLength = [];
    this.metricsValue = [];
    this.groupCount = 0;
  }

  getNodes = () => this.nodes;
  getEdges = () => this.edges;
  getVirtualNodes = () => this.virtualNodes;
  getVirtualEdges = () => this.virtualEdges;
  getMaxWidth = () => this.maxWidth;
  getMaxLength = () => this.maxLength;
  getGroupCount = () => this.groupCount;
  getMetricsValue = () => this.metricsValue;

  addNode = (nodeData) => {
    const id = nodeData[this.nodeIdProp];

    if (this.nodes[id] !== undefined) {
      throw new Error("Duplicate Node ID " + id);
    }

    const node = new VirtualNode(nodeData);
    this.nodes[id] = node;
    return node;
  };

  addEdge = (predecessorId, successorId) => {
    const predecessor = this.nodes[predecessorId];
    const successor = this.nodes[successorId];

    if (predecessor === undefined) {
      throw new Error("Predecessor not found, ID " + predecessorId);
    }
    if (successor === undefined) {
      throw new Error("Successor not found, ID " + successorId);
    }

    predecessor.addSuccessor(successor);
    this.edges[predecessorId] = [
      ...(this.edges[predecessorId] ?? []),
      successorId,
    ];
  };

  removeEdge = (predecessorId, successorId) => {
    const predecessor = this.nodes[predecessorId];
    const successor = this.nodes[successorId];

    if (predecessor === undefined) {
      throw new Error("Predecessor not found, ID " + predecessorId);
    }
    if (successor === undefined) {
      throw new Error("Successor not found, ID " + successorId);
    }

    predecessor.removeSuccessor(successor);
    this.edges[predecessorId] = (this.edges[predecessorId] ?? []).filter(
      (item) => item !== successorId
    );
  };

  equals = (otherGraph) => {
    if (!otherGraph) {
      return false;
    }

    const nodeIds = Object.keys(this.nodes);
    const otherNodeIds = Object.keys(otherGraph.nodes);

    if (nodeIds.length !== otherNodeIds.length) {
      return false;
    }

    otherNodeIds.sort();
    if (nodeIds.sort().some((node, i) => node !== otherNodeIds[i])) {
      return false;
    }

    const edgeIds = Object.keys(this.edges);
    const otherEdgeIds = Object.keys(otherGraph.edges);

    if (edgeIds.length !== otherEdgeIds.length) {
      return false;
    }

    otherEdgeIds.sort();

    return edgeIds.sort().every((pre, i) => {
      const otherPre = otherEdgeIds[i];

      if (pre !== otherPre) {
        return false;
      }

      const sucs = this.edges[pre];
      const otherSucs = otherGraph.edges[otherPre];

      if (sucs.length !== otherSucs.length) {
        return false;
      }

      otherSucs.sort();
      return sucs.sort().every((s, j) => s === otherSucs[j]);
    });
  };

  layout = ({
    previous = null,
    metrics = "crossings",
    thresholdEvaluate = 500000,
    thresholdLayer = 21000,
    alignNodes = "start",
    mergeVirtualNodes = "start",
    debug = false,
  } = {}) => {
    if (this.equals(previous)) {
      if (debug) {
        console.log("Graph layouting skipped, reusing previous results");
      }

      this.virtualNodes = previous.virtualNodes.map((node) =>
        node.virtual
          ? node
          : { ...node, data: this.nodes[node.data[this.nodeIdProp]].data }
      );
      this.virtualEdges = previous.virtualEdges;
      this.maxWidth = previous.maxWidth;
      this.maxLength = previous.maxLength;
      this.groupCount = previous.groupCount;
      return;
    }

    const time = Date.now();
    validate(thresholdEvaluate, thresholdLayer, alignNodes, metrics);

    const nodes = Object.values(this.nodes);
    const cyclicEdges = removeCycles(nodes);
    const nodeGroups = groupNodes(nodes);
    const groupCount = nodeGroups.length;

    for (let g = 0; g < groupCount; g++) {
      const nodeGroup = nodeGroups[g];
      const maxLength = calculateFlow(nodeGroup, alignNodes);
      const [layeredNodes, layeredEdges] = addVirtualNodes(
        nodeGroup,
        maxLength
      );

      while (mergeVirtualNodes) {
        mergeVirtualNodes = mergeNextVirtualNodeGroup(
          layeredNodes,
          layeredEdges,
          mergeVirtualNodes
        );
      }

      let start = 0,
        symmetry = true,
        permutations = 0.5;
      let maxWidth = 0;
      const permsLayer = Array(maxLength);
      const permWidthsLayer = Array(maxLength);
      const layeredMetrics = Array(maxLength);

      for (let i = 0; i < maxLength; i++) {
        const layer = layeredNodes[i];
        const width = layer.length;

        [permsLayer[i], permWidthsLayer[i]] = factorialLimited(
          width,
          thresholdLayer
        );
        layeredMetrics[i] = 0;
        maxWidth = maxWidth > width ? maxWidth : width;
      }

      for (let i = 0; i < maxLength; i++) {
        const ni = i + 1;
        const layer = layeredNodes[i];
        const width = layer.length;
        layer
          .sort(predecessorAverageSort)
          .forEach((item, idx) => (item.orth = (idx + 0.5) / width));
        const permsThisLayer = permsLayer[i];

        if (permsThisLayer === 1) {
          start = ni;
          symmetry = true;
          permutations = 0.5;
        } else {
          permutations *= permsThisLayer;
          const cutoffSymmetry = permsThisLayer === 2;
          const permsNextLayer = permsLayer[ni];
          const dependencyBreak =
            ni === maxLength || permsNextLayer === 1 || cutoffSymmetry;

          if (
            dependencyBreak ||
            permutations * permsNextLayer > thresholdEvaluate
          ) {
            permutations = findBestPermutation(
              layeredNodes,
              layeredEdges,
              layeredMetrics,
              permsLayer,
              permWidthsLayer,
              start,
              ni,
              symmetry,
              thresholdEvaluate,
              metrics,
              debug
            );

            if (permutations >= thresholdEvaluate) {
              start = i;
              symmetry = false;
              permutations = permsThisLayer;

              if (
                dependencyBreak ||
                permutations * permsNextLayer > thresholdEvaluate
              ) {
                permutations = findBestPermutation(
                  layeredNodes,
                  layeredEdges,
                  layeredMetrics,
                  permsLayer,
                  permWidthsLayer,
                  start,
                  ni,
                  symmetry,
                  thresholdEvaluate,
                  metrics,
                  debug
                );
              }
            }

            if (cutoffSymmetry) {
              start = ni;
              symmetry = false;
              permutations = 1;
            }
          }
        }
      }

      this.maxWidth[g] = maxWidth;
      this.maxLength[g] = maxLength;
      this.metricsValue[g] = layeredMetrics.reduce((acc, val) => acc + val, 0);

      for (const nodes of layeredNodes) {
        this.virtualNodes = [...this.virtualNodes, ...nodes];
      }
      for (const edges of layeredEdges) {
        this.virtualEdges = [
          ...this.virtualEdges,
          ...edges.map((edge) => new VirtualEdge(edge, false)),
        ];
      }
    }

    for (let i = 0; i < this.virtualNodes.length; i++) {
      this.virtualNodes[i].layoutId = i;
    }

    this.virtualEdges = [
      ...this.virtualEdges,
      ...cyclicEdges.map((edge) => new VirtualEdge(edge, true)),
    ];

    this.groupCount = groupCount;

    if (debug) {
      console.log("Graph layouting total time spent (ms):", Date.now() - time);
      console.log(
        "Graph minimized to " +
          this.metricsValue.reduce((acc, val) => acc + val, 0) +
          " " +
          metrics
      );
      console.log(
        "Graph was processed excluding %i cyclic edges",
        cyclicEdges.length
      );
    }
  };
}

export default Graph;
