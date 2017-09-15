function linkLayers(rootNode) {
  var nextChildren = rootNode.children || [];
  var toDoLists = [nextChildren.reverse()];
  rootNode["rels"] = {};
  var parents = [rootNode];

  //we need to do this for each process node
  // for the moment, assume that we have the root process node, P1.

  var tempProcessList = [{key: "PA", isRoot: true, processes:["P1", "P2"]}];  //this will be a list of process keys that leaf org nodes must have a relationship with to count
  //in fact this should be a list of lists, one for each process.

  lenToDoLists = toDoLists.length;
  while ((lenToDoLists > 0) && (sanity < 50)) {
    nextToDoList = toDoLists[lenToDoLists - 1];

    //concole.log("AA")

    if (nextToDoList.length == 0) {
      let discard = toDoLists.pop();
      let child =  parents.pop();
      let parent = parents[parents.length - 1];
      console.log("Hello");
console.log(parent);
      if (typeof(parent != "undefined")) {
        //if this is a leaf node then create relationships for it
        if (typeof(child.relationships) != "undefined") {
          initialiseRels(child, tempProcessList);
        }
        //rollup child to parent
        rollUp(parent, child, tempProcessList);
      } //else we should be done now.
    }
    else {
      let nextToDo = nextToDoList.pop();
      nextToDo["rels"] = {};
      parents.push(nextToDo);
      nextChildren = nextToDo.children || [];
      toDoLists.push(nextChildren.reverse());
    }
    lenToDoLists = toDoLists.length;
    sanity++;
  }
  console.log (rootNode);
}

function rollUp(parent, child, processFilterLists) {
  //copy up relationships into parent


  processFilterLists.forEach(function(processInfo, idx){
    //processInfo.key has the name of the process that we are summing for
    //processInfo.isRoot if true, no  filter required
//     console.log("helklo")
// console.log(child.rels)
// console.log(child.rels.keys)
// console.log("helklo")
var keys = Object.keys(child.rels)
    var filteredRelationships = keys.map(function(k){
        var x = {};
        x[k] = child.rels[k]
      return x;
    }); //child should always have a rels collection
    //console.log (filteredRelationships);

    var filterRequired = typeof(child.relationships) != "undefined" ? !processInfo.isRoot : false;

    //check if there is a rels context for this process on the parent
    var processKey = processInfo.key;

    var cxRels;
console.log(parent);
console.log(child);
    if (typeof(parent.rels[processKey]) != "undefined") {
        cxRels = parent.rels[processKey];
    }
    else {
      cxRels = {};
      parent.rels[processKey] = cxRels;
    }


    //cxRels is where we are going to store the relationships for this LHS node.
    if (filterRequired )  {
      // we are at the leaf level for LHS and will not have an entry in rels for this processInfo
      filteredRelationships = filteredRelationships.filter(function (rel){
        true; //for the moment
      });
    }

    //copy child rels up to parent (cxRels).
    filteredRelationships.forEach(function(r, i){
      //r is a child relation to copy up to parent
      let parentRel = cxRels[r.target];
      if (typeof(parentRel) != "undefined") {
        cxRels[r.target] = r.value;
      }
      else {
        cxRels[r.target] = cxRels[r.target] + r.value;
      }
    });
  });
  /*at the end of this we should have on the parent node

  */
}


function initialiseRels(leafNode, processFilterLists) {
  //this will look a lot like rollup, possibly rationalise later.


  var cx = {};
  leafNode["rels"] = cx;

  processFilterLists.forEach(function(processInfo, idx){
    //processInfo.key has the name of the process that we are summing for
    //processInfo.isRoot if true, no  filter required


    //var filterRequired = typeof(child.relationships) != "undefined" ? !processInfo.isRoot : false;
    var filterRequired = !processInfo.isRoot;

    //check if there is a rels context for this process on the parent
    var processKey = processInfo.key;

    var cxRels = {};
    cx[processKey] = cxRels;


    var filteredRelationships = leafNode.relationships.filter(function (r) {
      var retVal = false;
      if (filterRequired){
        return true; //for the moment.
      }
    });

    filteredRelationships.reduce(function(accum, r) {
        accum[r.target] = {target: r.target, value: r.value};
        return accum;
    }, cxRels);
    //we should now have on thr leaf nodes a rels dictionary keyed on process names
    //each of these will point to another dictionary
    console.log(leafNode)
  });
}

</script>


</body>
</html>
