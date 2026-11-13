(function(){
  function load(src){return fetch(src).then(r=>r.text());}
  Promise.all([load('app-part1.js'), load('app-part2.js')])
    .then(([a,b]) => { const s=document.createElement('script'); s.textContent=a+b; document.body.appendChild(s); })
    .catch(e => { document.body.innerHTML = '<pre style="color:#f88;padding:20px">Failed to load app: '+e+'</pre>'; });
})();
