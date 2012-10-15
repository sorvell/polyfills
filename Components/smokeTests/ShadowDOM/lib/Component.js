var $ = document.querySelector.bind(document);

var c$ = [];

var Component = function(inElement, inDefinition) {
  var elt = inElement;
  // track Components for debugging
  c$.push(elt);
  // make lightdom
  new LightDOM(elt);
  // make shadowdom
  for (var i=0, b; (b=inDefinition.bases[i]); i++) {
    new ShadowDOM(elt, $("template#" + b).content);
  }
  // mark it upgraded
  elt.is = inDefinition.name;
  elt.setAttribute("is", inDefinition.name);
  // splice in custom prototype
  elt.__proto__ = inDefinition.proto;
  // distribute nodes from light dom into shadow dom
  elt.distribute();
  // call initializer
  elt.created();
  // the element is the Component
  return elt;
};

Component.prototype = {
  __proto__: HTMLUnknownElement.prototype,
  events: {
  },
  created: function() {
    for (var n in this.events) {
      var fn = this[this.events[n]];
      if (fn) {
        this.addEventListener(n, fn.bind(this));
      }
    }
  }/*,
  distribute: function() {
    ShadowDOM.distribute(this);
  }*/
};

Component.registry = [];
Component.register = function(inName, inBases, inProto) {
  // our default prototype
  var proto = Component.prototype;
  // optionally chained
  if (inProto) {
    inProto.__proto__ = proto;
    proto = inProto;
  }
  // store definition
  Component.registry.push({
    name: inName,
    proto: proto,
    bases: inBases
  });
};

Component.upgradeAll = function(inNode) {
  var node = (inNode && inNode.baby) || inNode || document.body;
  Component.registry.forEach(function(d) {
    Component.upgradeName(node, d);
  });
};

Component.upgradeName = function(inNode, inDefinition) {
  var nodes = inNode.querySelectorAll(inDefinition.name);
  Array.prototype.forEach.call(nodes, function(n) {
    if (!n.is) {
      new Component(n, inDefinition);
    }
  });
};
