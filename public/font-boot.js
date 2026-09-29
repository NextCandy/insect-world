// Google Fonts 的样式表以 media=print 非阻塞加载；CSP 禁止 HTML 内联 onload。
// async 运行时资源也可能已从缓存加载完，所以先检查 sheet，再监听 load。
var fontLink = document.querySelector('link[data-iw-fonts]')
if (fontLink) {
  if (fontLink.sheet) fontLink.media = 'all'
  else fontLink.addEventListener('load', function () { fontLink.media = 'all' }, { once: true })
}
