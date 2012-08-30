/*
 * Copyright 2012 The Toolkitchen Authors. All rights reserved.
 * Use of this source code is goverened by a BSD-style
 * license that can be found in the LICENSE file.
 */

var JsShadowRoot, render;

(function() {
  'use strict';

  var slice = Array.prototype.slice.call.bind(Array.prototype.slice);

  /**
   * @param {!Node} node
   * @return {Array.<!Node> An array of the nodes.
   * @this
   */
  function getChildNodesSnapshot(node) {
    var result = [], i = 0;
    for (var child = this.getFirstChild(node); child; child = this.getNextSibling(child)) {
      result[i++] = child;
    }
    return result;
  }

  // This object groups DOM operations. This is supposed to be the DOM as the
  // developer sees it.
  // TODO(arv): Implement a real logical view of the DOM.
  var logical = {
    getParentNode: function(node) {
      return node.parentNode;
    },
    getFirstChild: function(node) {
      return node.firstChild;
    },
    getNextSibling: function(node) {
      return node.nextSibling;
    },
    removeAllChildNodes: function(parentNode) {
      parentNode.textContent = '';
    },
    getChildNodesSnapshot: getChildNodesSnapshot
  };

  // This object groups DOM operations. This is supposed to be the DOM as the
  // browser/render tree sees it.
  var visual = {
    removeAllChildNodes: function(parentNode) {
      parentNode.textContent = '';
    },
    appendChild: function(parentNode, child) {
      parentNode.appendChild(child);
    },
    getChildNodesSnapshot: getChildNodesSnapshot
  };

  var treeToInsertionPointMap = new Map();

  function distributeChildToInsertionPoint(child, insertionPoint) {
    // console.log('Distributing', child, 'to', insertionPoint);
    treeToInsertionPointMap.set(child, insertionPoint);
    if (!insertionPoint.__distributedChildNodes__)
      insertionPoint.__distributedChildNodes__ = [];
    insertionPoint.__distributedChildNodes__.push(child);
  }

  /**
   * Visits all nodes in the tree that fulfils the |predicate|. If the |visitor|
   * function returns |false| the traversal is aborted.
   * @param {!Node} tree
   * @param {function(!Node) : boolean} predicate
   * @param {function(!Node) : *} visitor
   */
  function visit(tree, predicate, visitor) {
    // This operates on logical DOM.
    for (var node = logical.getFirstChild(tree);
         node;
         node = logical.getNextSibling(node)) {
      if (predicate(node)) {
        if (visitor(node) === false)
          return;
      } else {
        visit(node, predicate, visitor);
      }
    }
  }

  function distributeNodeToInsertionPoint(node, insertionPoint) {
    treeToInsertionPointMap.set(node, insertionPoint);
  }


  function distributeRemainingTo(nodes, insertionPoint) {
    nodes.forEach(function(node) {
      distributeNodeToInsertionPoint(node, insertionPoint);
    });
  }

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#dfn-distribution-algorithm
  function distribute(tree, pool) {
    visit(tree, isActiveInsertionPoint,
        function(insertionPoint) {
          for (var i = 0; i < pool.length; i++) {  // 1.2
            var node = pool[i];  // 1.2.1
            if (matchesCriteria(node, insertionPoint)) {  // 1.2.2
              distributeChildToInsertionPoint(node, insertionPoint);  // 1.2.2.1
              // TODO(arv): splice is O(n)
              pool.splice(i--, 1);  // 1.2.2.2
            }
          }
        });
  }

  // Matching Insertion Points
  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#matching-insertion-points

  // TODO(arv): Verify this... I don't remember why I picked this regexp.
  var selectorMatchRegExp = /^[*.:#[a-zA-Z_|]/;

  var allowedPseudoRegExp = new RegExp('^:(' + [
    'link',
    'visited',
    'target',
    'enabled',
    'disabled',
    'checked',
    'indeterminate',
    'nth-child',
    'nth-last-child',
    'nth-of-type',
    'nth-last-of-type',
    'first-child',
    'last-child',
    'first-of-type',
    'last-of-type',
    'only-of-type',
  ].join('|') + ')');


  function oneOf(object, propertyNames) {
    for (var i = 0; i < propertyNames.length; i++) {
      if (propertyNames[i] in object)
        return propertyNames[i];
    }
  }

  var matchesSelector = oneOf(document.documentElement,
      ['matchesSelector', 'msMatchesSelector', 'mozMatchesSelector',
      'webkitMatchesSelector']);

  /**
   * @param {Element} node
   * @oaram {Element} point The insertion point element.
   * @return {boolean} Whether the node matches the insertion point.
   */
  function matchesCriteria(node, point) {
    var select = point.getAttribute('select');
    if (!select)
      return true;

    if (node.nodeType !== Node.ELEMENT_NODE)
      return false;

    // TODO(arv): This does not seem right. Need to check for a simple selector.
    if (!selectorMatchRegExp.test(select))
      return false;

    if (select[0] === ':' && allowedPseudoRegExp.test(select))
      return false;

    try {
      return node[matchesSelector](select);
    } catch (ex) {
      // Invalid selector.
      return false;
    }
  }

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#multiple-shadow-subtrees
  function treeComposition(shadowHost) {
    var tree = getYoungestTree(shadowHost);
    var pool = logical.getChildNodesSnapshot(shadowHost);
    var shadowInsertionPoint, point;
    while (tree) {
      shadowInsertionPoint = undefined;  // Reset every iteration.
      visit(tree, isActiveShadowInsertionPoint, function(point) {
        shadowInsertionPoint = point;
        return false;
      });
      point = shadowInsertionPoint;
      distribute(tree, pool);
      if (point) {
        var nextOlderTree = getNextOlderTree(tree);
        if (!nextOlderTree) {
          distributeRemainingTo(pool, point);
          break;
        } else {
          tree = nextOlderTree;
          assignShadowTreeToShadowInsertionPoint(tree, point);
          continue;
        }
      } else {
        break;
      }
    }
  }

  // http://dvcs.w3.org/hg/webcomponents/raw-file/tip/spec/shadow/index.html#rendering-shadow-subtrees
  function render(host) {
    treeComposition(host);
    var shadowDOM = getYoungestTree(host);
    if (!shadowDOM)
      return;
    var shadowDOMChildNodes = logical.getChildNodesSnapshot(shadowDOM);

    visual.removeAllChildNodes(host);

    shadowDOMChildNodes.forEach(function(node) {
      renderNode(host, shadowDOM, node, false);
    });
  }

  function isShadowRoot(node) {
    return node.__shadowHost__;
  }

  function isInsertionPoint(node) {
    // Should this include <shadow>?
    return node.tagName == 'CONTENT';
  }

  function getShadowHost(shadowRoot) {
    throw shadowRoot.__shadowHost__;
  }

  function isActiveInsertionPoint(node) {
    // <content> inside another <content> or <shadow> is considered inactive.
    return node.tagName === 'CONTENT';
  }

  function isShadowInsertionPoint(node) {
    return node.tagName === 'SHADOW';
  }

  function isActiveShadowInsertionPoint(node) {
    // <shadow> inside another <content> or <shadow> is considered inactive.
    return node.tagName === 'SHADOW';
  }

  function isShadowHost(shadowHost) {
    return !!shadowHost.__shadowRoot__;
  }

  function getYoungestTree(shadowHost) {
    return shadowHost.__shadowRoot__;
  }

  function getNextOlderTree(tree) {
    return tree.__nextOlderShadowTree__;
  }

  var treeToShadowInsertionPointMap = new Map();

  function assignShadowTreeToShadowInsertionPoint(tree, point) {
    // console.log('Assign %o to %o', tree, point);
    treeToShadowInsertionPointMap.set(tree, point);
  }

  function isAssignedToAShadowInsertionPoint(node) {
    // This is wrong
    return treeToShadowInsertionPointMap.has(node);
  }

  function getShadowInsertionPointNode(node) {
    // This is wrong
    return treeToShadowInsertionPointMap.get(node);
  }

  function isShadowInsertionPoint(node) {
    return node.tagName === 'SHADOW';
  }

  function renderNode(visualParent, tree, node, isNested) {
    if (isShadowHost(node))
      render(node);
    else if (isInsertionPoint(node))
      renderInsertionPoint(visualParent, tree, node, isNested);
    else if (isShadowInsertionPoint(node))
      renderShadowInsertionPoint(visualParent, tree, node);
    else
      renderAsAnyDomSubtree(visualParent, tree, node, isNested);
  }

  function renderInsertionPoint(visualParent, tree, insertionPoint, isNested) {
    // console.log('renderInsertionPoint');
    if (insertionPoint.__distributedChildNodes__ && insertionPoint.__distributedChildNodes__.length) {
      insertionPoint.__logicalChildNodes__ = logical.getChildNodesSnapshot(insertionPoint);
      visual.removeAllChildNodes(insertionPoint);

      insertionPoint.__distributedChildNodes__.forEach(function(child) {
        if (isInsertionPoint(child) && isNested)
          renderInsertionPoint(visualParent, tree, child, isNested);
        else
          renderAsAnyDomSubtree(visualParent, tree, child, isNested);
      });
    } else {
      renderFallbackContent(visualParent, insertionPoint);
    }
    // FIXME: Backup
    insertionPoint.parentNode.removeChild(insertionPoint);
  }
  function renderAsAnyDomSubtree(visualParent, tree, child, isNested) {
    // console.log('render', child);
    visual.appendChild(visualParent, child);

    var parent = child;
    var logicalChildNodes = logical.getChildNodesSnapshot(parent);
    logicalChildNodes.forEach(function(node) {
      renderNode(parent, tree, node, isNested);
    });
  }

  function renderShadowInsertionPoint(visualParent, tree, shadowInsertionPoint) {
    if (tree.__nextOlderShadowTree__) {
      tree = tree.__nextOlderShadowTree__;
      var shadowDOMChildNodes = logical.getChildNodesSnapshot(tree);

      // FIXME: Backup
      shadowInsertionPoint.parentNode.removeChild(shadowInsertionPoint);

      shadowDOMChildNodes.forEach(function(child) {
        // renderAsAnyDomSubtree
        renderNode(visualParent, tree, child, true);
      });
    } else {
      renderFallbackContent(visualParent, shadowInsertionPoint);
    }
  }

  function renderFallbackContent(visualParent, fallbackHost) {
    var logicalChildNodes = logical.getChildNodesSnapshot(fallbackHost);
    logicalChildNodes.forEach(function(node) {
      // console.log('renderFallbackContent', node);
      visual.appendChild(visualParent, node);
    });
  }

  function JsShadowRoot(host) {
    var newShadowRoot = host.ownerDocument.createDocumentFragment();
    var oldShadowRoot = host.__shadowRoot__;
    if (oldShadowRoot)
      newShadowRoot.__nextOlderShadowTree__ = oldShadowRoot;
    host.__shadowRoot__ = newShadowRoot;
    newShadowRoot.__shadowHost__ = host;
    return newShadowRoot;
  }

  // Export
  window.JsShadowRoot = JsShadowRoot;
  window.render = render;
})();