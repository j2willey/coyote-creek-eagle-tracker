// One header for every page (logo + name). Put this where the header goes:
//   <header class="brand" data-site-header></header><script src="js/header.js"></script>
// Committee pages add data-committee: "Coyote Creek Advancement Committee", logo links to /committee.
(function () {
  document.querySelectorAll('header[data-site-header]').forEach(function (h) {
    var committee = h.hasAttribute('data-committee');
    var a = document.createElement('a');
    a.href = committee ? '/committee' : '/';
    a.className = 'brand-link';
    a.innerHTML = '<img src="/images/coyote-creek-160.png" width="72" height="72" alt="">' +
      '<div class="name">Coyote Creek Advancement' + (committee ? ' Committee' : '') +
      '<small>Coyote Creek District · Silicon Valley Monterey Bay Council</small></div>';
    h.replaceChildren(a);
  });
})();
