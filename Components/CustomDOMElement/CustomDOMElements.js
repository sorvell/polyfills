/*
 * Copyright 2012 The Toolkitchen Authors. All rights reserved.
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file.
 */

(function(scope) {

scope = scope || {};

// imports

var shadowDomImpl = scope.shadowDomImpl;

// custom element definition registry (name: definition)

var registry = {
};

// SECTION 4

var instantiate = function(inPrototype) {
  // 4.a.1. Create a new object that implements PROTOTYPE
  // 4.a.2. Let ELEMENT by this new object
  //
  // the custom element instantiation algorithm must also ensure that the
  // output is a valid DOM element with the proper wrapper in place.
  //
  var element = domCreateElement(inPrototype.is);
  element.__proto__ = inPrototype;
  //
  // OUTPUT
  return element;
};

var finalize = function(inElement, inDefinition) {
  //
  // 4.a.3. Let CHAIN be ELEMENT's prototype chain, in reverse order
  // (starting with the most-derived object)
  // 4.a.4. For each item in CHAIN:
  //  1. Let ITEM be this item
  //  2. Let DEFINITION be a registered element definition that has ITEM as
  //  element prototype.
  //  3. If DEFINITION was not found, stop.
  //  4. If DEFINITION has element template:
  //    1. Let TEMPLATE be this template
  //    2. Create a shadow root with ELEMENT as its host
  //    3. Clone TEMPLATE as contents of this shadow root
  //
  // build a chain of derived objects (including this one)
  // first element is most-derived object
  var chain = getAncestorChain(inDefinition);
  //
  // cache shadows so we can call 'shadowRootCreated' asynchronously
  var shadows = [];
  //
  // walk the chain to create shadows
  chain.forEach(function(definition) {
    // create shadow dom, cache the root
    shadows.push(createShadowDom(inElement, definition));
  });
  // upgrade elements before doing shadow dom so that any references created
  // during distribution do not become stale.
  upgradeAll(inElement);
  //
  // do shadow dom distribution (for shims that do this imperatively)
  if (inDefinition.template) {
    // use polymorphic shadowDomImpl
    shadowDomImpl.installDom(inElement);
    // upgrade custom elements that came from templates
    upgradeAll(inElement);
  }
  //
  // TODO(sjmiles): OFF SPEC:
  // walk ancestor chain again in support of lifecycle.shadowRootCreated
  // and lifecycle.attributeChanged
  chain.forEach(function(definition, i) {
    var fn = definition.lifecycle.shadowRootCreated;
    if (fn) {
      fn.call(inElement, shadows[i]);
    }
    // TODO(sjmiles): OFF SPEC: support lifecycle.attributeChanged
    // TODO(sjmiles): redesign so we only do this once
    observeAttributeChanges(inElement, definition);
  });
  //
  // upgrade custom elements that haven't been upgraded yet (due to race
  // condition in light dom upgrade, or user manipulation)
  upgradeAll(inElement);
  //
  // TODO(sjmiles): OFF SPEC: support lifecycle.created
  if (inDefinition.lifecycle.created) {
    // TODO(sjmiles): OFF SPEC: inDefinition.prototype.extendsName
    var ancestor = registry[inDefinition.prototype.extendsName];
    inDefinition.lifecycle.created.call(inElement,
      ancestor && ancestor.lifecycle.created);
  }
};

var getAncestorChain = function(inDefinition) {
  // build a chain of derived definitions (including inDefintion)
  // first element is most-derived object
  var chain = [inDefinition];
  var p = inDefinition.prototype;
  while (registry[p.extendsName]) {
    chain.unshift(registry[p.extendsName]);
    p = p.__proto__;
  }
  return chain;
};

var createShadowDom = function(inElement, inDefinition) {
  if (inDefinition.template) {
    // 4.a.3.1 create a shadow root with ELEMENT as it's host
    // 4.a.3.2. clone template as contents of this shadow root
    //
    // use polymorphic shadowDomImpl
    var shadow = shadowDomImpl.createShadowDom(inElement,
      inDefinition.template.content.cloneNode(true));
  }
  return shadow;
};

var observeAttributeChanges = function(inElement, inDefinition) {
  // Setup mutation observer for attribute changes
  //
  // TODO(sjmiles): attaches a fresh observer for each
  // inherited definition. Instead, build one observer and have it walk
  // the definition chain to find change handlers.
  //
  var lc = inDefinition.lifecycle;
  if (lc.attributeChanged && window.WebKitMutationObserver){
    var observer = new WebKitMutationObserver(function(mutations) {
      mutations.forEach(function(m) {
        lc.attributeChanged.call(inElement, m.attributeName,
          m.oldValue, m.target.getAttribute(m.attributeName));
      });
    });
    //
    //console.log("attaching mutation observer to ", inElement)
    observer.observe(inElement, {
      attributes: true,
      attributeOldValue: true
    });
  }
};

var generateConstructor = function(inDefinition) {
  // 4.b.1. Generate a function object which, when called:
  // 4.b.1.1. Runs the custom element instantiation algorithm with PROTOTYPE
  // and TEMPLATE as arguments.
  // 4.b.1.2. Returns algorithm's output as result
  // 4.b.2. Let CONSTRUCTOR be that function object
  var constructor = function() {
    var element = instantiate(inDefinition.prototype);
    finalize(element, inDefinition);
    return element;
  };
  // TODO(sjmiles): OFF SPEC: flag this constructor so we can identify it
  // in instantiate above
  constructor.generated = true;
  // 4.b.3. Set PROTOTYPE as the prototype property on CONSTRUCTOR
  constructor.prototype = inDefinition.prototype;
  // 4.b.3. Set CONSTRUCTOR as the constructor property on PROTOTYPE.
  inDefinition.prototype.constructor = constructor;
  return constructor;
};

// SECTION 5

var generatePrototype = function(inExtends, inProperties) {
  // 5.a.1 If EXTENDS is an invalid HTML tag name, throw an
  // InvalidCharacterError exception.
  if (!inExtends) {
    throw "5.a.1. InvalidCharacterError: extends must be a valid HTML tag name";
  }
  // 5.a.2. If EXTENDS is a custom element name, let BASE be the element
  // prototype of the custom DOM element with the custom element name EXTENDS
  if (registry[inExtends]) {
    var base = registry[inExtends].prototype;
  }
  else {
    // 5.a.3. Otherwise
    // 5.a.3.1 If EXTENDS is defined in HTML specification or other applicable
    // specifications, let BASE be the interface prototype object for the
    // element type corresponding to the HTML tag name of EXTENDS
    // 5.a.3.2 Otherwise, throw a NotSupportedError exception.
    // TODO(sjmiles): validation
    base = document.createElement(inExtends).__proto__;
  }
  //
  // TODO(sjmiles): this is improper implementation of 'define properties'
  // the spec means Object.defineProperties
  // we are using prototype swizzling instead, which also
  // means we don't need 'object that implements BASE'
  // as in spec.
  //
  // 5.a.4 Create a new object that implements BASE
  // 5.a.5 Let PROTOTYPE be this new object
  //var prototype = Object.create(base);
  //
  // 5.a.3.5 If PROPERTIES is present and not undefined, define properties on
  // PROTOTYPE using PROPERTIES
  //
  // TODO(sjmiles): handle undefined inProperties
  //
  // strategy: properties as prototype
  //
  var prototype = inProperties || {};
  //
  // chain the prototype to base
  //
  prototype.__proto__ = base;
  //
  // TODO(sjmiles): OFF SPEC: we need to store our extends name somewhere
  // so we can look up ancestor properties during initialization
  //
  prototype.extendsName = inExtends;
  //
  // OUTPUT
  return prototype;
};

var transplantNode = function(upgrade, element) {
  upgrade.model = element.model;
  forEach(element.attributes, function(a) {
    upgrade.setAttribute(a.name, a.value);
    // if there is an mdv attribute binding, add it to the upgraded element
    if (a.bindingText) {
      upgrade.addBinding(a.name, a.bindingText);
    }
  });
  var n$ = [];
  forEach(element.childNodes, function(n) {
    //if (!isTemplate(n)) {
      n$.push(n);
    //}
  });
  // TODO(sjmiles): make bug reduction: appending children after creating
  // shadow DOM seems to result in an unstable node if n$.length == 1 and
  // n$[0] is a text node
  forEach(n$, function(n) {
      //console.log(n);
      upgrade.appendChild(n);
  });
  //
  element.parentNode.replaceChild(upgrade, element);
};

var upgradeElement = function(inElement, inDefinition) {
  // do not re-upgrade
  if (inElement && inElement.__upgraded__) {
     return inElement;
  }
  // 5.b.2.3. Let UPGRADE be the result of running custom element
  // instantiation algorithm with PROTOTYPE and TEMPLATE as arguments
  var upgrade = instantiate(inDefinition.prototype);
  // do not re-upgrade
  upgrade.__upgraded__ = true;
  // TODO(sjmiles): OFF SPEC: attach 'is' attribute
  upgrade.setAttribute("is", inDefinition.name);
  // 5.b.2.4 Replace ELEMENT with UPGRADE in TREE
  if (inElement) {
    transplantNode(upgrade, inElement);
  }
  // compute redistributions
  finalize(upgrade, inDefinition);
  // we need to upgrade any custom elements that appeared
  // as a result of this upgrade
  upgradeAll(upgrade);
  // 5.b.3 On UPGRADE, fire an event named elementupgrade with its bubbles
  // attribute set to true.
  // TODO(sjmiles): implement elementupgrade event
  return upgrade;
};

var upgradeElements = function(inTree, inDefinition) {
  // 6.b.1 Let NAME be the custom element name part of DEFINITION
  var name = inDefinition.name;
  // 6.b.2 For each element ELEMENT in TREE whose custom element name is NAME:
  var elements = inTree.querySelectorAll(name);
  for (var i=0, element; element=elements[i]; i++) {
    // when an element is upgraded, its children are upgraded. This makes
    // stale elements in this list that are children of components. Avoid
    // trying to upgrading them by checking if they have a parentNode.
    if (element.parentNode) {
      upgradeElement(element, inDefinition);
    }
  }
};

var	upgradeAll = function(inNode) {
	for (var n in registry) {
		upgradeElements(inNode, registry[n]);
	}
};

// SECTION 6

// polyfill UA parsing HTML by watching dom for changes via mutations observer
// and upgrading if any are detected.
var watchDom = function() {
  var observer = new WebKitMutationObserver(function(mutations) {
		mutations.forEach(function(mxn){
			if (mxn.addedNodes.length) {
				upgradeAll(document);
			}
    });
  });
  observer.observe(document.body, {childList: true, subtree: true});
}

// SECTION 7.1

var validateArguments = function(inName, inOptions) {
  // The custom element name must start with a U+0078 LATIN SMALL LETTER X,
  // followed by U+002D HYPHEN-MINUS
  // TODO(sjmiles): wrong test
  if (!inName) {
    // 7.1.1. If NAME is an invalid custom element name, throw an
    // InvalidCharacterError exception.
    // TODO(sjmiles): wrong exception
    throw("name required");
  }
  // The element prototype itself must inherit from the HTMLElement interface
  var p = inOptions.prototype;
  if (p && !(p instanceof HTMLElement)) {
    // 7.1.3. if PROTOTYPE does not inherit from the HTMLElement interface,
    // throw a TypeMismatchError exception.
    throw "7.1.3. TypeMismatchError:  element prototype must inherit from HTMLElement";
  }
};

var register = function(inName, inOptions) {
  //
  // 7. Input
  //	DOCUMENT, the document on which the method is called
  //	NAME, the custom element name of the element being registered
  //	PROTOTYPE, the element prototype, optional
  //	TEMPLATE, the custom element template, optional
  //
  // TODO(sjmiles): resolve discrepancy between input and the formal arguments
  //
  validateArguments(inName, inOptions);
  var template = inOptions.template;
  // 7.1.2 If PROTOTYPE is missing, let PROTOTYPE be the interface prototype
  // object for the HTMLSpanElement interface
  var prototype = inOptions.prototype || HTMLSpanElement.prototype;
  // TODO(sjmiles): putting name on prototype not in spec
  prototype.is = inName;
  // TODO(sjmiles): lifecycle not in spec
  var lifecycle = inOptions.lifecycle || {};
  // 7.1.4 Let DEFINITION be the tuple of (PROTOTYPE, TEMPLATE, NAME)
  var definition = {
    prototype: prototype,
    template: template,
    name: inName,
    // TODO(sjmiles): OFF SPEC: lifecycle not in spec
    lifecycle: lifecycle
  };
  //
  // TODO(sjmiles): OFF SPEC: get tricky with lifecycle
  var ancestor = registry[prototype.extendsName];
  if (ancestor) {
    lifecycle.__proto__ = ancestor.lifecycle;
  }
  //
  // 7.1.5: Register the DEFINITION with DOCUMENT
  registry[inName] = definition;
  //
  // TODO(sjmiles): OFFSPEC: re-ordering the flow
  // so that prototype has the correct constructor on it
  // at instantiate time (when we call upgradeElements)
  //
  // 7.1.7. Run custom element constructor generation algorithm with PROTOTYPE
  // and TEMPLATE as arguments
  // 7.1.8. Return the output of the previous step.
  // 7. Output: CONSTRUCTOR, the custom element constructor
  var ctor = generateConstructor(definition);
  // TODO(sjmiles): OFF SPEC: for deubgging only
  ctor.tag = inName;
  //
  // 7.1.6: For DOCUMENT tree and every shadow DOM subtree enclosed by
  // DOCUMENT tree:
  //
  // TODO(sjmiles): "and every shadow DOM subtree" may not be possible
  // from polyfill. We will ensure this happens for shadow subtrees
  // created by this polyfill, but any others are invisible.
  //
  // 7.1.6.1. Let TREE be this tree
  // 7.1.6.2. Run element upgrade algorithm with TREE and DEFINITION as
  // arguments
  //
  upgradeElements(document, definition);
  //
  return ctor;
};

// SECTION 7.2

// see HTMLElementElement.js

// exports

scope.CustomDOMElements = {
  registry: registry,
  instantiate: instantiate,
  generateConstructor: generateConstructor,
  generatePrototype: generatePrototype,
  upgradeElements: upgradeElements,
  upgradeAll: upgradeAll,
  watchDom: watchDom,
  validateArguments: validateArguments,
  register: register
};

// new public API

document.register = register;

// rewrite public API

var domCreateElement = document.createElement.bind(document);

document.createElement = function(inTagName) {
  var def = registry[inTagName];
  return def ? upgradeElement(null, def) : domCreateElement(inTagName);
}

})(window.__exported_components_polyfill_scope__);