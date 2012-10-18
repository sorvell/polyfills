(function(){

var test = function() {
  render(function(){/*
     <A>
        <div>To DIV perchance</div><span>To SPAN or not</span>
      </A>
      <template id="A">
        A's template<br/>
        div content:
        <content select="div"></content>
        span content:
        <div><content select="span"></content></div>
      </template>
  */});
  // make ShadowRoot
  var root = new ShadowRoot("A", "A");
  return actualContent(root.host);
};

describe("(5.1)-content-select", function() {
  var expected = "A's template<br>        div content:        <div>To DIV perchance</div>        span content:        <div><span>To SPAN or not</span></div>";
  testImpls(test, expected);
});

})();