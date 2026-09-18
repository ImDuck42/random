// ==================================================================================================== //
// PAWCHIVE GALLERY PLUGIN
// ==================================================================================================== //
;(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory)
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.PawchivePlugin = factory()
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  // ==================================================================================================== //
  // CONFIGURATION
  // ==================================================================================================== //
  const DEFAULT_API_BASE   = 'https://pawchive.pw/api/v1'
  const DEFAULT_DATA_BASE  = 'https://file.pawchive.pw/data'
  const DEFAULT_THUMB_BASE = 'https://img.pawchive.pw/thumbnail/data'
  const DEFAULT_CDN_BASE   = 'https://pawchive.pw'
  const JSZIP_CDN_URL      = 'https://cdn.jsdelivr.net/npm/jszip@3.10.2/dist/jszip.min.js'
  const STEP_SIZE          = 50

  const ACCENTS = [
    'rosewater', 'flamingo', 'pink', 'mauve', 'red',      'maroon', 'peach',
    'yellow',    'green',    'teal', 'sky',   'sapphire', 'blue',   'lavender'
  ]

  const EXT_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i
  const EXT_ANIM  = /\.(gif|apng|webp)$/i
  const EXT_VIDEO = /\.(mp4|webm|mov|m4v|ogg)$/i
  const EXT_ZIP   = /\.zip$/i

  const WS_ONLY  = /[\s \n\r]/g
  const IS_BLANK = text => !text.replace(WS_ONLY, '')
  const SELF_OK  = new Set(['IMG', 'VIDEO', 'IFRAME', 'AUDIO', 'HR'])
  
  const ALLOWED_TAGS = new Set([
    'P', 'BR', 'A', 'IMG', 'VIDEO', 'SOURCE', 'AUDIO', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'EM', 'B', 'I', 'U', 'S', 'SPAN', 'DIV',
    'FIGURE', 'FIGCAPTION', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'CODE',
    'PRE', 'SUP', 'SUB', 'SMALL'
  ])
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META', 'BASE'])

  const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, char => ESCAPE_MAP[char])

  // ==================================================================================================== //
  // PLUGIN STATE
  // ==================================================================================================== //
  let isPawchiveActive           = false
  let accentIndex                = 0
  let toastTimerId               = null
  let creatorsCacheList          = null
  let currentPostsSearchQuery    = ''
  let currentCreatorsSearchQuery = ''
  let postsDataOffset            = 0
  let creatorsDataOffset         = 0
  let isLoadingPosts             = false
  let hasMorePosts               = true
  let isLoadingCreators          = false
  let hasMoreCreators            = true
  let pawchiveUIObserver         = null
  let pawchiveLastScrollTop      = 0
  let currentSort                = { key: 'name', dir: 'up' }

  const creatorState = {
    service: null,
    id:      null,
    name:    '',
    tab:     'posts',
    tag:     '',
    query:   '',
    profile: null,
    links:   []
  }

  const originalUIState = {
    tab1Label:          'Folders',
    tab2Label:          'Gallery',
    folderGridHTML:     '',
    galleryMasonryHTML: '',
    searchPlaceholder:  ''
  }

  const scrollCache = {
    creators: 0,
    posts:    0,
    other:    0
  }

  const endpointConfig = {
    api:   localStorage.getItem('pawchive_api_url')   || DEFAULT_API_BASE,
    data:  localStorage.getItem('pawchive_media_url') || DEFAULT_DATA_BASE,
    thumb: localStorage.getItem('pawchive_thumb_url') || DEFAULT_THUMB_BASE,
    cdn:   DEFAULT_CDN_BASE
  }

  const getNextAccent = ()        => ACCENTS[accentIndex++ % ACCENTS.length]
  const getMediaUrl   = path      => path ? endpointConfig.data + path : ''
  const getThumbUrl   = path      => path ? endpointConfig.thumb + path : ''
  const getIconUrl    = (srv, id) => `${endpointConfig.cdn}/icons/${srv}/${id}`
  const getBannerUrl  = (srv, id) => `${endpointConfig.cdn}/banners/${srv}/${id}`
  const getFileName   = file      => file?.name || file?.path || ''

  const formatSize = bytes => bytes ? (bytes / 1048576).toFixed(2) + ' MB' : ''
  const formatDate = value => {
    if (!value) return ''
    const date = new Date(value)
    return isNaN(date) ? String(value) : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  }

  const generateLoadingHtml = () => '<div class="loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>'
  const generateEmptyHtml   = (message, icon = 'fa-paw') => `
    <div class="empty-state">
      <span class="big"><i class="fa-solid ${icon}"></i></span>
      ${escapeHtml(message)}
    </div>`
    
  const generateBadgeHtml   = service => `
    <span class="service-badge ${escapeHtml(service)}">
      <span>${escapeHtml(service)}</span>
    </span>`

  // ==================================================================================================== //
  // API
  // ==================================================================================================== //
  async function fetchApi(path) {
    const response = await fetch(endpointConfig.api + path, { headers: { Accept: 'application/json' } })
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`API error ${response.status}`)
    return response.json()
  }

  async function fetchCreatorsList() {
    if (creatorsCacheList) return creatorsCacheList
    
    const rawData = await fetchApi('/creators') || []
    const groups  = {}

    for (const creator of rawData) {
      const key      = (creator.name || creator.id).toLowerCase().trim()
      const favCount = parseInt(creator.favorited) || 0
      
      if (!groups[key]) groups[key] = { name: creator.name || creator.id, maxFav: 0, profiles: [] }
      
      groups[key].profiles.push({ ...creator, fav: favCount })
      if (favCount > groups[key].maxFav) groups[key].maxFav = favCount
    }

    creatorsCacheList = Object.values(groups)
      .map(group => (group.profiles.sort((a, b) => b.fav - a.fav), group))
      .sort((a, b) => b.maxFav - a.maxFav)
      
    return creatorsCacheList
  }

  // ==================================================================================================== //
  // SANITIZATION
  // ==================================================================================================== //
  function isEmptyDomNode(node) {
    if (node.nodeType === Node.TEXT_NODE)    return IS_BLANK(node.textContent)
    if (node.nodeType !== Node.ELEMENT_NODE) return true
    if (node.tagName === 'BR')               return true
    if (SELF_OK.has(node.tagName))           return false
    return IS_BLANK(node.textContent) && !node.querySelector('img, video, iframe, audio, hr')
  }

  function trimDomEnds(element) {
    while (element.firstChild && isEmptyDomNode(element.firstChild)) element.removeChild(element.firstChild)
    while (element.lastChild  && isEmptyDomNode(element.lastChild))  element.removeChild(element.lastChild)
  }

  function sanitizeHtml(htmlString) {
    const parser   = new DOMParser()
    const document = parser.parseFromString(String(htmlString ?? ''), 'text/html')

    const walkDom = root => {
      [...root.children].forEach(element => {
        if (DROP_TAGS.has(element.tagName))       return void element.remove()
        if (!ALLOWED_TAGS.has(element.tagName))   return void element.replaceWith(...element.childNodes)

        ;[...element.attributes].forEach(({ name, value }) => {
          const attributeName = name.toLowerCase()
          const isJavaScript  = (attributeName === 'href' || attributeName === 'src') && /^\s*javascript:/i.test(value)
          
          if (attributeName.startsWith('on') || attributeName === 'srcset' || isJavaScript) {
            element.removeAttribute(name)
          }
        })

        if (element.tagName === 'A') {
          element.target = '_blank'
          element.rel    = 'noopener'
        }
        
        if (element.tagName === 'IMG') {
          element.setAttribute('referrerpolicy', 'no-referrer')
          element.loading = 'lazy'
        }
        
        walkDom(element)
      })
    }

    walkDom(document.body)
    
    trimDomEnds(document.body)
    if (document.body.firstChild?.nodeType === Node.ELEMENT_NODE) trimDomEnds(document.body.firstChild)
    if (document.body.lastChild?.nodeType  === Node.ELEMENT_NODE) trimDomEnds(document.body.lastChild)
    
    return document.body.innerHTML
  }

  // ==================================================================================================== //
  // DOM & CSS
  // ==================================================================================================== //
  function injectPluginStyles() {
    if (document.getElementById('pawchive-plugin-styles')) return

    const styleElement = document.createElement('style')
    styleElement.id    = 'pawchive-plugin-styles'
    styleElement.textContent = `
      /* Host Modal Override */
      body.pawchive-active .full-screen { 
        display:        none !important; 
        opacity:        0    !important; 
        pointer-events: none !important; 
      }

      /* Universal Classes */
      .pawchive-hide { 
        display: none !important; 
      }

      /* Masonry Layout Alignments */
      .gallery-masonry,
      #postModalMasonry.gallery-masonry,
      #pawchiveZipMasonry.gallery-masonry {
        grid-template-columns: var(--grid-columns, repeat(auto-fill, minmax(250px, 1fr))) !important;
        grid-auto-rows:        1px  !important;
        gap:                   20px !important;
        width:                 auto !important;
      }
      .gallery-masonry:not(.pawchive-hide),
      #postModalMasonry.gallery-masonry:not(.pawchive-hide),
      #pawchiveZipMasonry.gallery-masonry:not(.pawchive-hide) {
        display: grid !important;
      }
      
      .gallery-card {
        position:         relative !important;
        display:          block    !important;
        width:            100%     !important;
        overflow:         hidden   !important;
        background-color: rgb(var(--ctp-surface0-rgb)) !important;
        border:           var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)) !important;
        border-radius:    18px !important;
        box-shadow:       3px 3px 0 rgb(var(--ctp-crust-rgb)) !important;
        cursor:           pointer !important;
        transform:        translateZ(0);
        transition:       all 0.2s ease, transform 0.2s var(--cubic-bezier) !important;
      }
      .gallery-card img, 
      .gallery-card video {
        display:          block !important; 
        width:            100%  !important; 
        height:           100%  !important;
        object-fit:       cover !important; 
        background-color: rgb(var(--ctp-mantle-rgb)) !important;
      }
      .gallery-card:hover {
        transform:    translateY(-2px) !important; 
        border-color: rgb(var(--accent)) !important;
        box-shadow:   1px 1px 0 rgb(var(--accent)), 2px 2px 0 rgb(var(--accent)) !important;
      }
      .gallery-card:active {
        transform:  translateY(1px) !important; 
        box-shadow: 1px 1px 0 rgb(var(--accent)) !important;
      }
      
      .placeholder-media {
        display:         flex; 
        flex-direction:  column; 
        align-items:     center; 
        justify-content: center;
        width:           100%; 
        height:          100%; 
        min-height:      140px; 
        background:      rgb(var(--ctp-surface1-rgb));
        color:           rgb(var(--ctp-subtext0-rgb)); 
        font-size:       2.2rem;
      }
      .placeholder-media span { 
        margin-top: 8px; 
        font:       800 0.9rem sans-serif; 
      }
      
      .gallery-card .card-tag {
        position:       absolute; 
        top:            10px; 
        left:           10px; 
        z-index:        2; 
        padding:        4px 12px;
        background:     rgb(var(--ctp-crust-rgb)); 
        border:         2px solid rgb(var(--accent));
        border-radius:  8px; 
        color:          rgb(var(--accent)); 
        font:           800 0.7rem sans-serif;
        text-transform: uppercase; 
        pointer-events: none; 
        transform:      skewX(-20deg);
      }
      .gallery-card .card-tag span { 
        display:   inline-block; 
        transform: skewX(20deg); 
      }

      /* Native Button Replacements */
      .btn, 
      .modal-nav .btn, 
      .modal-nav .button {
        display:         inline-flex !important; 
        align-items:     center !important; 
        gap:             10px !important;
        padding:         10px 24px !important; 
        background:      rgb(var(--ctp-surface1-rgb)) !important;
        border:          var(--border-width, 3px) solid rgb(var(--accent, var(--ctp-mauve-rgb))) !important;
        border-radius:   10px !important; 
        color:           rgb(var(--accent, var(--ctp-mauve-rgb))) !important;
        font:            var(--font-label, 800 0.85rem sans-serif) !important; 
        box-shadow:      3px 3px 0 rgb(var(--ctp-crust-rgb)) !important;
        cursor:          pointer !important; 
        transform:       skewX(-20deg) !important; 
        transition:      all 0.2s var(--cubic-bezier) !important;
        text-decoration: none !important;
      }
      .btn > *, 
      .modal-nav .btn > *, 
      .modal-nav .button > * {
        display:     inline-flex !important; 
        align-items: center !important; 
        gap:         8px !important; 
        transform:   skewX(20deg) !important;
      }
      .btn:hover:not(:disabled), 
      .modal-nav .btn:hover:not(:disabled), 
      .modal-nav .button:hover:not(:disabled) {
        background: rgb(var(--accent, var(--ctp-mauve-rgb))) !important; 
        color:      rgb(var(--ctp-crust-rgb)) !important;
      }
      .btn:active:not(:disabled), 
      .modal-nav .btn:active:not(:disabled), 
      .modal-nav .button:active:not(:disabled) {
        box-shadow: 1px 1px 0 rgb(var(--ctp-crust-rgb)) !important; 
        transform:  skewX(-20deg) translateY(2px) !important;
      }
      .btn:disabled, 
      .modal-nav .btn:disabled, 
      .modal-nav .button:disabled {
        opacity:    0.4 !important; 
        cursor:     not-allowed !important; 
        transform:  skewX(-20deg) !important; 
        box-shadow: none !important;
      }

      /* Creator Hero Elements */
      .creator-hero {
        margin:        16px; 
        background:    rgb(var(--ctp-surface0-rgb));
        border:        4px solid rgb(var(--ctp-surface1-rgb)); 
        border-radius: 18px;
        box-shadow:    6px 6px 0 rgb(var(--ctp-crust-rgb)); 
        overflow:      hidden;
      }
      .creator-banner {
        position:   relative; 
        height:     220px;
        background: radial-gradient(1200px 200px at 20% 0%, rgba(var(--ctp-mauve-rgb), 0.25), transparent),
                    radial-gradient(800px 200px at 80% 20%, rgba(var(--ctp-blue-rgb), 0.18), transparent),
                    rgb(var(--ctp-mantle-rgb));
      }
      .creator-banner img { 
        width:      100%; 
        height:     100%; 
        object-fit: cover; 
      }
      .creator-banner::after {
        content:    ""; 
        position:   absolute; 
        inset:      0;
        background: linear-gradient(180deg, transparent 40%, rgba(var(--ctp-surface0-rgb), 0.9));
      }
      
      .creator-hero-row {
        position:    relative; 
        z-index:     2; 
        display:     flex; 
        flex-wrap:   wrap;
        align-items: flex-end; 
        gap:         20px; 
        margin-top:  -56px; 
        padding:     0 24px;
      }
      .creator-avatar, 
      .creator-avatar-fallback {
        width:         112px; 
        height:        112px; 
        flex-shrink:   0; 
        border:        5px solid rgb(var(--ctp-surface0-rgb));
        border-radius: 20px;
      }
      .creator-avatar { 
        background: rgb(var(--ctp-mantle-rgb)); 
        object-fit: cover; 
      }
      .creator-avatar-fallback {
        display:         flex; 
        align-items:     center; 
        justify-content: center;
        background:      linear-gradient(135deg, rgb(var(--ctp-mauve-rgb)), rgb(var(--ctp-blue-rgb)));
        color:           rgb(var(--ctp-crust-rgb)); 
        font:            800 2.4rem sans-serif;
      }
      
      .creator-hero-text { 
        min-width:      0; 
        padding-bottom: 6px; 
      }
      .creator-hero-text h1 {
        display:     flex; 
        flex-wrap:   wrap; 
        align-items: center; 
        gap:         12px; 
        margin:      0;
        font:        800 1.6rem sans-serif; 
        color:       rgb(var(--ctp-text-rgb)) !important;
      }
      .creator-hero-text h1 .creator-name-text {
        color: rgb(var(--ctp-text-rgb)) !important;
      }
      
      .creator-stats {
        display:    flex; 
        flex-wrap:  wrap; 
        gap:        16px; 
        margin-top: 8px; 
        color:      rgb(var(--ctp-subtext0-rgb)); 
        font:       600 0.85rem sans-serif;
      }
      .creator-stats b { 
        color: rgb(var(--ctp-text-rgb)); 
      }
      
      .link-chips { 
        display:   flex; 
        flex-wrap: wrap; 
        gap:       10px; 
        padding:   16px 24px 8px; 
      }
      .link-chips .chip {
        display:         inline-flex; 
        align-items:     center; 
        gap:             7px; 
        padding:         8px 18px;
        background:      rgb(var(--ctp-crust-rgb)); 
        border:          2px solid rgb(var(--ctp-mauve-rgb));
        border-radius:   10px; 
        color:           rgb(var(--ctp-text-rgb)); 
        font:            var(--font-label, 800 0.85rem sans-serif);
        transform:       skewX(-20deg); 
        cursor:          pointer; 
        text-decoration: none; 
        transition:      all 0.2s ease;
      }
      .link-chips .chip > * { 
        display:     inline-flex; 
        align-items: center; 
        gap:         8px; 
        transform:   skewX(20deg); 
      }
      .link-chips .chip:hover { 
        background:   rgb(var(--ctp-surface0-rgb)); 
        border-color: rgb(var(--ctp-lavender-rgb)); 
        color:        rgb(var(--ctp-text-rgb)); 
      }
      .link-chips .chip:active { 
        transform: skewX(-20deg) scale(0.95); 
      }
      
      .service-badge {
        padding:        4px 12px; 
        background:     rgb(var(--ctp-crust-rgb)); 
        border:         2px solid rgb(var(--ctp-mauve-rgb));
        border-radius:  8px; 
        color:          rgb(var(--ctp-mauve-rgb)); 
        font:           800 0.7rem sans-serif;
        text-transform: uppercase; 
        transform:      skewX(-20deg); 
        display:        inline-flex;
      }
      .service-badge span    { display: inline-block; transform: skewX(20deg); }
      .service-badge.fanbox  { border-color: rgb(var(--ctp-pink-rgb));  color: rgb(var(--ctp-pink-rgb)); }
      .service-badge.patreon { border-color: rgb(var(--ctp-peach-rgb)); color: rgb(var(--ctp-peach-rgb)); }
      .service-badge.gumroad { border-color: rgb(var(--ctp-green-rgb)); color: rgb(var(--ctp-green-rgb)); }
      .service-badge.discord { border-color: rgb(var(--ctp-blue-rgb));  color: rgb(var(--ctp-blue-rgb)); }

      .creator-tabbar { 
        display:     flex; 
        flex-wrap:   wrap; 
        align-items: center; 
        gap:         12px; 
        padding:     16px 24px 20px; 
      }

      /* Auto-Download Module */
      .auto-dl-container {
        display:        flex; 
        flex-direction: column; 
        gap:            8px; 
        margin-left:    auto; 
        margin-bottom:  6px;
        padding:        10px 16px; 
        background:     rgb(var(--ctp-mantle-rgb)); 
        border:         var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb));
        border-radius:  14px; 
        box-shadow:     2px 2px 0 rgb(var(--ctp-crust-rgb));
      }
      .auto-dl-title { 
        display:     flex; 
        align-items: center; 
        gap:         8px; 
        color:       rgb(var(--ctp-text-rgb)); 
        font:        800 0.85rem sans-serif; 
      }
      .auto-dl-title i { 
        color: rgb(var(--ctp-mauve-rgb)); 
      }
      .auto-dl-inputs { 
        display:     flex; 
        align-items: center; 
        gap:         12px; 
      }
      .auto-dl-inputs input[type="text"] {
        width:         140px; 
        padding:       6px 12px; 
        background:    rgb(var(--ctp-crust-rgb));
        border:        2px solid rgb(var(--ctp-surface1-rgb)); 
        border-radius: 8px; 
        color:         rgb(var(--ctp-text-rgb));
        font:          700 0.8rem sans-serif; 
        outline:       none; 
        transition:    border-color 0.2s;
      }
      .auto-dl-inputs input[type="text"]:focus { 
        border-color: rgb(var(--ctp-mauve-rgb)); 
      }

      .switch { 
        position:    relative; 
        display:     inline-block; 
        width:       42px; 
        height:      24px; 
        flex-shrink: 0; 
      }
      .switch input { 
        position:       absolute; 
        width:          0; 
        height:         0; 
        opacity:        0; 
        margin:         0; 
        pointer-events: none; 
      }
      .switch .slider {
        position:      absolute; 
        inset:         0; 
        background:    rgb(var(--ctp-surface1-rgb)); 
        border-radius: 20px;
        cursor:        pointer; 
        transition:    background-color 0.25s ease;
      }
      .switch .slider::before {
        position:         absolute; 
        content:          ""; 
        left:             3px; 
        bottom:           3px; 
        width:            18px; 
        height:           18px;
        background:       rgb(var(--ctp-text-rgb)); 
        border-radius:    50%; 
        transition:       transform 0.25s ease, background-color 0.25s ease;
      }
      .switch input:checked + .slider { 
        background: rgb(var(--ctp-green-rgb)); 
      }
      .switch input:checked + .slider::before { 
        transform:  translateX(18px); 
        background: rgb(var(--ctp-crust-rgb)); 
      }

      /* Inspector Modals */
      .modal {
        position:        fixed; 
        inset:           0; 
        z-index:         999; 
        display:         flex; 
        align-items:     center;
        justify-content: center; 
        padding:         24px;
      }
      .modal[hidden]       { display: none !important; }
      #pawchive-zip-modal  { z-index: 1000; }
      
      .modal-backdrop { 
        position:        absolute; 
        inset:           0; 
        background:      rgba(var(--ctp-crust-rgb), 0.85); 
        backdrop-filter: blur(8px); 
      }
      .modal-shell {
        position:       relative; 
        display:        flex; 
        flex-direction: column; 
        width:          100%; 
        max-width:      1400px;
        height:         100%; 
        background:     rgb(var(--ctp-mantle-rgb));
        border:         4px solid rgb(var(--ctp-surface1-rgb)); 
        border-radius:  20px; 
        box-shadow:     12px 12px 0 rgba(0,0,0,0.4);
      }
      .modal-close {
        position:        absolute; 
        top:             20px; 
        right:           20px; 
        z-index:         10; 
        display:         flex; 
        align-items:     center;
        justify-content: center; 
        width:           44px; 
        height:          44px; 
        background:      rgb(var(--ctp-surface0-rgb));
        border:          var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)); 
        border-radius:   10px;
        color:           rgb(var(--ctp-subtext0-rgb)); 
        font-size:       1.2rem; 
        cursor:          pointer; 
        transition:      all 0.15s ease;
      }
      .modal-close:hover { 
        border-color: rgb(var(--ctp-red-rgb)); 
        color:        rgb(var(--ctp-red-rgb)); 
      }
      
      .modal-body { 
        flex:       1;
        min-height: 0 !important;
        padding:    30px 40px; 
        overflow-y: auto; 
        color:      rgb(var(--ctp-text-rgb)); 
      }
      .modal-body h2 { 
        margin:        0 0 10px; 
        padding-right: 60px; 
        font:          800 1.6rem sans-serif; 
        color:         rgb(var(--ctp-text-rgb)); 
      }
      .modal-meta { 
        display:       flex; 
        flex-wrap:     wrap; 
        align-items:   center; 
        gap:           16px; 
        margin-bottom: 20px; 
        color:         rgb(var(--ctp-subtext0-rgb)); 
        font:          600 0.85rem sans-serif; 
      }
      .modal-meta i { 
        color: rgb(var(--accent, var(--ctp-mauve-rgb))); 
      }
      
      .modal-body a, 
      .post-content a, 
      .comment a, 
      .revision a {
        color:           rgb(var(--ctp-blue-rgb)) !important; 
        text-decoration: none !important; 
        transition:      color 0.15s ease !important;
      }
      .modal-body a:hover, 
      .post-content a:hover, 
      .comment a:hover, 
      .revision a:hover {
        text-decoration: underline !important; 
        color:           rgb(var(--ctp-lavender-rgb)) !important;
      }
      .modal-meta a {
        color:           rgb(var(--ctp-blue-rgb)) !important; 
        text-decoration: none !important; 
        display:         inline-flex !important;
        align-items:     center !important; 
        gap:             6px !important; 
        font-weight:     700 !important;
      }
      .modal-meta a:hover { 
        text-decoration: underline !important; 
        color:           rgb(var(--ctp-lavender-rgb)) !important; 
      }

      .modal-tabs { 
        display:   flex; 
        flex-wrap: wrap; 
        gap:       12px; 
        margin:    24px 0 16px; 
      }
      .modal-tabs .chip {
        display:       inline-flex; 
        align-items:   center; 
        gap:           7px; 
        padding:       8px 18px;
        background:    rgb(var(--ctp-crust-rgb)); 
        border:        2px solid rgb(var(--ctp-mauve-rgb));
        border-radius: 10px; 
        color:         rgb(var(--ctp-text-rgb)); 
        font:          var(--font-label, 800 0.85rem sans-serif);
        transform:     skewX(-20deg); 
        cursor:        pointer; 
        transition:    all 0.2s ease;
      }
      .modal-tabs .chip > * { 
        display:     inline-flex; 
        align-items: center; 
        gap:         8px; 
        transform:   skewX(20deg); 
      }
      .modal-tabs .chip.active { 
        background:  rgb(var(--ctp-mauve-rgb)); 
        color:       rgb(var(--ctp-crust-rgb)); 
        font-weight: 800; 
      }
      
      .modal-nav { 
        display:         flex !important; 
        justify-content: space-between !important; 
        gap:             16px !important; 
        margin-top:      30px !important; 
      }

      /* Zip Viewer */
      .zip-container { 
        display:       flex; 
        flex-wrap:     wrap; 
        align-items:   flex-start; 
        gap:           16px; 
        margin-bottom: 24px; 
      }
      .zip-container-divider { 
        border:     none; 
        border-top: 2px dashed rgb(var(--ctp-surface2-rgb)); 
        margin:     10px 0 24px; 
      }
      .zip-card {
        display:       inline-flex; 
        align-items:   center; 
        gap:           16px; 
        width:         auto; 
        max-width:     100%; 
        padding:       16px 24px;
        background:    rgb(var(--ctp-surface0-rgb)); 
        border:        var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb));
        border-radius: 14px; 
        box-shadow:    4px 4px 0 rgb(var(--ctp-crust-rgb)); 
        cursor:        pointer; 
        transition:    all 0.2s var(--cubic-bezier);
      }
      .zip-card:hover { 
        border-color: rgb(var(--ctp-yellow-rgb)); 
        box-shadow:   6px 6px 0 rgb(var(--ctp-crust-rgb)); 
        transform:    translateY(-4px); 
      }
      .zip-card:active { 
        box-shadow: 2px 2px 0 rgb(var(--ctp-crust-rgb)); 
        transform:  translateY(2px); 
      }
      .zip-icon {
        display:         flex; 
        align-items:     center; 
        justify-content: center; 
        width:           48px; 
        height:          48px; 
        flex-shrink:     0;
        background:      rgba(var(--ctp-yellow-rgb), 0.15); 
        border:          var(--border-width, 3px) solid rgb(var(--ctp-yellow-rgb));
        border-radius:   12px; 
        color:           rgb(var(--ctp-yellow-rgb)); 
        font-size:       1.4rem;
      }
      .zip-name { 
        font:       800 1.05rem sans-serif; 
        word-break: break-all; 
        color:      rgb(var(--ctp-text-rgb)); 
      }
      .zip-sub { 
        margin-top: 4px; 
        color:      rgb(var(--ctp-subtext0-rgb)); 
        font:       600 0.85rem sans-serif; 
      }

      /* Embedded HTML Contexts */
      .post-content {
        margin-bottom: 20px; 
        padding:       20px 24px; 
        background:    rgb(var(--ctp-surface0-rgb));
        border:        var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)); 
        border-radius: 14px;
        color:         rgb(var(--ctp-text-rgb)); 
        font-size:     0.95rem; 
        font-weight:   500; 
        line-height:   1.6;
        overflow-wrap: break-word; 
        user-select:   text;
      }
      .post-content blockquote {
        margin:        0.8rem 0; 
        padding:       0.4rem 1rem; 
        background:    rgb(var(--ctp-mantle-rgb));
        border-left:   4px solid rgb(var(--ctp-mauve-rgb)); 
        border-radius: 0 10px 10px 0; 
        color:         rgb(var(--ctp-subtext0-rgb));
      }
      .post-content img { 
        display:       block; 
        max-width:     100%; 
        height:        auto; 
        margin:        0.6rem 0; 
        border-radius: 10px; 
        cursor:        zoom-in; 
      }
      
      .comment, 
      .revision, 
      .announcement {
        margin-bottom: 14px !important; 
        padding:       14px 18px !important; 
        background:    rgb(var(--ctp-surface0-rgb)) !important;
        border:        var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)) !important; 
        border-radius: 14px !important;
        font-weight:   500 !important; 
        color:         rgb(var(--ctp-text-rgb)) !important;
      }
      .comment div, 
      .revision div, 
      .announcement div {
        color:       rgb(var(--ctp-text-rgb)) !important; 
        line-height: 1.5 !important; 
        word-break:  break-word !important; 
        user-select: text !important;
      }
      .item-head {
        display:       flex !important; 
        flex-wrap:     wrap !important; 
        align-items:   center !important; 
        gap:           10px !important;
        margin-bottom: 8px !important; 
        color:         rgb(var(--ctp-subtext0-rgb)) !important; 
        font:          600 0.8rem sans-serif !important;
      }
      .item-head i { 
        color: rgb(var(--accent, var(--ctp-mauve-rgb))) !important; 
      }
      .comment-rev {
        margin-top:   10px !important; 
        padding-left: 12px !important; 
        border-left:  4px solid rgb(var(--ctp-surface2-rgb)) !important;
        color:        rgb(var(--ctp-subtext0-rgb)) !important; 
        font-size:    0.8rem !important;
      }
      
      .hash-result {
        margin-bottom: 24px; 
        padding:       20px 24px; 
        background:    rgb(var(--ctp-surface0-rgb));
        border:        var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)); 
        border-radius: 14px; 
        box-shadow:    4px 4px 0 rgb(var(--ctp-crust-rgb));
      }
      .hash-result dl { 
        display:               grid; 
        grid-template-columns: auto 1fr; 
        gap:                   8px 20px; 
        margin:                0; 
        font:                  600 0.85rem sans-serif; 
      }
      .hash-result dt { 
        color: rgb(var(--ctp-subtext0-rgb)); 
      }
      .hash-result dd { 
        margin:      0; 
        font-family: monospace; 
        font-size:   0.9rem; 
        word-break:  break-all; 
        user-select: text; 
      }
      
      .section-title { 
        display:     flex; 
        align-items: center; 
        gap:         10px; 
        margin:      24px 0 14px; 
        font:        800 1.1rem sans-serif; 
        color:       rgb(var(--ctp-text-rgb)); 
      }
      .fancard-grid { 
        display:               grid; 
        grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); 
        gap:                   20px; 
      }
      .fancard-grid img { 
        width:         100%; 
        border:        var(--border-width, 3px) solid rgb(var(--ctp-surface1-rgb)); 
        border-radius: 14px; 
        cursor:        zoom-in; 
        transition:    transform 0.15s var(--cubic-bezier); 
      }
      .fancard-grid img:hover { 
        border-color: rgb(var(--accent, var(--ctp-mauve-rgb))); 
        transform:    translateY(-4px); 
      }

      /* Custom Lightbox */
      .lightbox {
        position:        fixed; 
        inset:           0; 
        z-index:         99999; 
        display:         flex; 
        align-items:     center;
        justify-content: center; 
        background:      rgba(var(--ctp-crust-rgb), 0.95); 
        backdrop-filter: blur(10px);
      }
      .lightbox[hidden] { 
        display: none !important; 
      }
      .lightbox-close {
        position:        absolute; 
        top:             24px; 
        right:           24px; 
        z-index:         100000; 
        display:         flex; 
        align-items:     center;
        justify-content: center; 
        width:           50px; 
        height:          50px; 
        background:      rgb(var(--ctp-surface0-rgb));
        border:          4px solid rgb(var(--ctp-surface2-rgb)); 
        border-radius:   14px; 
        color:           rgb(var(--ctp-text-rgb));
        font-size:       1.5rem; 
        box-shadow:      6px 6px 0 rgb(var(--ctp-crust-rgb)); 
        cursor:          pointer; 
        transform:       skewX(-15deg);
        transition:      all 0.2s var(--cubic-bezier);
      }
      .lightbox-close i { 
        transform: skewX(15deg); 
      }
      .lightbox-close:hover { 
        border-color: rgb(var(--ctp-red-rgb)); 
        color:        rgb(var(--ctp-red-rgb)); 
        transform:    skewX(-15deg) translateY(-3px); 
      }
      .lightbox-content { 
        display:         flex; 
        align-items:     center; 
        justify-content: center; 
        width:           100%; 
        height:          100%; 
        max-height:      100dvh;
        padding:         24px; 
        box-sizing:      border-box;
      }
      .lightbox-content img, 
      .lightbox-content video {
        max-width:        100%; 
        max-height:       calc(100dvh - 48px) !important;
        width:            auto !important; 
        height:           auto !important; 
        object-fit:       contain; 
        background:       rgb(var(--ctp-mantle-rgb));
        border:           4px solid rgb(var(--ctp-surface1-rgb)); 
        border-radius:    16px; 
        box-shadow:       0 10px 25px rgba(0, 0, 0, 0.6);
      }

      /* Toasts */
      .toast {
        position:      fixed; 
        left:          50%; 
        bottom:        30px; 
        z-index:       999999; 
        padding:       12px 24px;
        background:    rgb(var(--ctp-surface0-rgb)); 
        border:        var(--border-width, 3px) solid rgb(var(--ctp-red-rgb));
        border-radius: 12px; 
        box-shadow:    6px 6px 0 rgba(0, 0, 0, 0.4); 
        color:         rgb(var(--ctp-text-rgb));
        font:          700 0.9rem sans-serif; 
        transform:     translateX(-50%); 
        animation:     poop-in 0.2s var(--cubic-bezier);
      }
      .toast.ok { 
        border-color: rgb(var(--ctp-green-rgb)); 
      }
      .toast[hidden] { 
        display: none !important; 
      }

      /* Misc Elements */
      .loading, 
      .empty-state {
        grid-column: 1 / -1; 
        padding:     4rem 1rem; 
        color:       rgb(var(--ctp-subtext0-rgb));
        text-align:  center; 
        font:        700 1rem sans-serif;
      }
      .empty-state .big { 
        display:       block; 
        margin-bottom: 12px; 
        color:         rgb(var(--ctp-mauve-rgb)); 
        font-size:     2.6rem; 
      }
      
      /* Minimum Effort Mobile Adjustments */
      @media (max-width: 768px) {
        .modal { padding: 12px; }
        .modal-shell { max-height: calc(100vh - 24px); border-radius: 16px; }
        .modal-body { padding: 24px 20px; }
        .modal-body h2 { padding-right: 50px; font-size: 1.3rem; }
        .modal-close { top: 12px; right: 12px; }
        .lightbox-content { padding: 10px; }
        .lightbox-close { top: 10px; right: 10px; width: 44px; height: 44px; }
        .creator-banner { height: 160px; }
        .creator-hero-row { margin-top: -44px; }
        .creator-avatar, .creator-avatar-fallback { width: 88px; height: 88px; }
        .auto-dl-container { width: 100%; margin-top: 14px; margin-left: 0; }
      }
    `
    document.head.appendChild(styleElement)
  }

  function injectModals() {
    if (!document.getElementById('pawchive-post-modal')) {
      const modal     = document.createElement('div')
      modal.id        = 'pawchive-post-modal'
      modal.className = 'modal'
      modal.hidden    = true
      modal.innerHTML = `
        <div class="modal-backdrop" data-close-pawchive-modal></div>
        <div class="modal-shell" role="dialog" aria-modal="true">
          <button class="modal-close" data-close-pawchive-modal aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <div id="pawchiveModalBody" class="modal-body"></div>
        </div>`
      document.body.appendChild(modal)
    }

    if (!document.getElementById('pawchive-zip-modal')) {
      const zipModal     = document.createElement('div')
      zipModal.id        = 'pawchive-zip-modal'
      zipModal.className = 'modal'
      zipModal.hidden    = true
      zipModal.innerHTML = `
        <div class="modal-backdrop" data-close-pawchive-zip></div>
        <div class="modal-shell" role="dialog" aria-modal="true">
          <button class="modal-close" data-close-pawchive-zip aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <div id="pawchiveZipModalBody" class="modal-body"></div>
        </div>`
      document.body.appendChild(zipModal)
    }

    if (!document.getElementById('pawchive-lightbox')) {
      const lightbox     = document.createElement('div')
      lightbox.id        = 'pawchive-lightbox'
      lightbox.className = 'lightbox'
      lightbox.hidden    = true
      lightbox.innerHTML = `
        <div class="lightbox-close" data-close-pawchive-lightbox>
          <i class="fa-solid fa-xmark"></i>
        </div>
        <div class="lightbox-content" id="pawchiveLightboxContent"></div>`
      document.body.appendChild(lightbox)
    }

    if (!document.getElementById('pawchive-toast')) {
      const toast     = document.createElement('div')
      toast.id        = 'pawchive-toast'
      toast.className = 'toast'
      toast.hidden    = true
      document.body.appendChild(toast)
    }
  }

  function triggerToast(message, isOk = false) {
    const toastElement = document.getElementById('pawchive-toast')
    if (!toastElement) return
    
    toastElement.textContent = message
    toastElement.classList.toggle('ok', isOk)
    toastElement.hidden      = false
    
    clearTimeout(toastTimerId)
    toastTimerId = setTimeout(() => { toastElement.hidden = true }, 4200)
  }

  // ==================================================================================================== //
  // LIGHTBOX & ZIP
  // ==================================================================================================== //
  function openLightbox(source, type, fallbackSource = '') {
    const lightboxBox     = document.getElementById('pawchive-lightbox')
    const lightboxContent = document.getElementById('pawchiveLightboxContent')
    if (!lightboxBox || !lightboxContent) return

    lightboxBox.hidden = false
    
    if (type === 'img') {
      lightboxContent.innerHTML = `
        <img src="${escapeHtml(source)}" alt="" 
             ${fallbackSource ? `data-fallback="${escapeHtml(fallbackSource)}"` : ''}
             onerror="if(this.dataset.fallback && this.dataset.step !== 'thumb') { this.dataset.step = 'thumb'; this.src = this.dataset.fallback; }">`
    } else {
      lightboxContent.innerHTML = `<video src="${escapeHtml(source)}" controls autoplay></video>`
    }
  }

  function closeLightbox() {
    const lightboxBox     = document.getElementById('pawchive-lightbox')
    const lightboxContent = document.getElementById('pawchiveLightboxContent')
    if (lightboxBox)     lightboxBox.hidden        = true
    if (lightboxContent) lightboxContent.innerHTML = ''
  }

  function closeZipModal() {
    const zipModal = document.getElementById('pawchive-zip-modal')
    if (zipModal) zipModal.hidden = true
  }

  async function ensureJSZipLibrary() {
    if (typeof JSZip !== 'undefined') return JSZip
    
    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${JSZIP_CDN_URL}"]`)
      if (existingScript) {
        existingScript.addEventListener('load',  () => resolve(window.JSZip))
        existingScript.addEventListener('error', () => reject(new Error('Failed to load JSZip')))
        return
      }
      
      const scriptElement = document.createElement('script')
      scriptElement.src     = JSZIP_CDN_URL
      scriptElement.onload  = () => resolve(window.JSZip)
      scriptElement.onerror = () => reject(new Error('Failed to load JSZip CDN'))
      document.head.appendChild(scriptElement)
    })
  }

  async function openZipArchive(url, name) {
    const zipModal = document.getElementById('pawchive-zip-modal')
    const zipBody  = document.getElementById('pawchiveZipModalBody')
    if (!zipModal || !zipBody) return

    zipModal.hidden   = false
    zipBody.innerHTML = `<h2><i class="fa-solid fa-file-zipper"></i> ${escapeHtml(name)}</h2>${generateLoadingHtml()}`

    try {
      await ensureJSZipLibrary()

      const response = await fetch(url, { referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const archiveData = await JSZip.loadAsync(await response.arrayBuffer())
      const fileEntries = Object.values(archiveData.files).filter(file => !file.dir)

      if (!fileEntries.length) {
        zipBody.innerHTML = `<h2><i class="fa-solid fa-file-zipper"></i> ${escapeHtml(name)}</h2>${generateEmptyHtml('Empty archive.', 'fa-box-open')}`
        return
      }

      zipBody.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:16px;">
          <h2 style="margin:0; padding:0;"><i class="fa-solid fa-file-zipper"></i> ${escapeHtml(name)}</h2>
          <a class="btn" href="${escapeHtml(url)}" target="_blank" download style="--accent: var(--ctp-green-rgb);">
            <span><i class="fa-solid fa-download"></i> Download ZIP</span>
          </a>
        </div>
        <div class="view-sub" style="margin-bottom: 24px; color: rgb(var(--ctp-subtext0-rgb)); font: 600 0.85rem sans-serif;">${fileEntries.length} file(s) inside</div>
        <div class="gallery-masonry" id="pawchiveZipMasonry"></div>`

      const gridContainer = document.getElementById('pawchiveZipMasonry')

      for (const entry of fileEntries.slice(0, 400)) {
        if (!EXT_IMAGE.test(entry.name) && !EXT_VIDEO.test(entry.name)) continue

        const galleryCard       = document.createElement('div')
        galleryCard.className   = 'gallery-card'
        galleryCard.style.cssText = `--accent: var(--ctp-${getNextAccent()}-rgb);`

        try {
          const blobUrl = URL.createObjectURL(await entry.async('blob'))

          if (EXT_IMAGE.test(entry.name)) {
            galleryCard.innerHTML = `<img src="${blobUrl}" alt="" loading="lazy">`
            galleryCard.onclick   = () => openLightbox(blobUrl, 'img')
            galleryCard.querySelector('img').addEventListener('load', () => packGalleryCard(galleryCard))
          } else {
            galleryCard.innerHTML = `<video src="${blobUrl}" muted playsinline></video>`
            const videoElement    = galleryCard.querySelector('video')
            
            galleryCard.onmouseenter = () => videoElement.play().catch(() => {})
            galleryCard.onmouseleave = () => { videoElement.pause(); videoElement.currentTime = 0 }
            galleryCard.onclick      = () => openLightbox(blobUrl, 'video')
            videoElement.addEventListener('loadedmetadata', () => packGalleryCard(galleryCard))
          }

          const sizeTag       = document.createElement('span')
          sizeTag.className   = 'card-tag'
          sizeTag.innerHTML   = `<span>${((entry._data?.uncompressedSize || 0) / 1024).toFixed(1)} KB</span>`
          
          galleryCard.appendChild(sizeTag)
          gridContainer.appendChild(galleryCard)
        } catch (ignored) {}
      }
    } catch (error) {
      zipBody.innerHTML = `
        <h2><i class="fa-solid fa-file-zipper"></i> ${escapeHtml(name)}</h2>
        <div class="notice" style="margin-bottom:20px; padding:14px 18px; background:rgba(var(--ctp-red-rgb),0.1); border:2px solid rgb(var(--ctp-red-rgb)); border-radius:12px; color:rgb(var(--ctp-red-rgb));">
          <i class="fa-solid fa-triangle-exclamation"></i> Could not preview: ${escapeHtml(error.message)}
        </div>
        <p>
          <a class="btn" href="${escapeHtml(url)}" target="_blank" download>
            <span><i class="fa-solid fa-download"></i> Download directly</span>
          </a>
        </p>`
    }
  }

  // ==================================================================================================== //
  // MASONRY & RENDERING
  // ==================================================================================================== //
  function packGalleryCard(cardElement, gridStylesCache) {
    if (!cardElement) return
    
    const gridContainer = cardElement.closest('.gallery-masonry')
    const mediaElement  = cardElement.querySelector('img, video')
    if (!gridContainer) return

    let mediaWidth  = 0
    let mediaHeight = 0
    
    if (mediaElement) {
      if (mediaElement.tagName === 'VIDEO') {
        if (mediaElement.videoWidth) {
          mediaWidth  = mediaElement.videoWidth
          mediaHeight = mediaElement.videoHeight
        } else if (mediaElement.poster) {
          const posterImage = new Image()
          posterImage.src   = mediaElement.poster
          if (posterImage.complete && posterImage.naturalWidth) {
            mediaWidth  = posterImage.naturalWidth
            mediaHeight = posterImage.naturalHeight
          } else {
            posterImage.onload = () => packGalleryCard(cardElement, gridStylesCache)
            return
          }
        }
      } else {
        mediaWidth  = mediaElement.naturalWidth
        mediaHeight = mediaElement.naturalHeight
      }
      if (!mediaWidth) return
    } else if (!cardElement.querySelector('.placeholder-media')) {
      return
    }

    const cardWidth = cardElement.getBoundingClientRect().width
    if (cardWidth === 0) {
      requestAnimationFrame(() => packGalleryCard(cardElement, gridStylesCache))
      return
    }

    const scaledHeight    = mediaElement ? (cardWidth * mediaHeight / mediaWidth) : 140
    const computedStyles  = gridStylesCache || getComputedStyle(gridContainer)
    const gridRowHeight   = parseFloat(computedStyles.getPropertyValue('grid-auto-rows')) || 1
    const gridGap         = parseFloat(computedStyles.getPropertyValue('row-gap')) || parseFloat(computedStyles.getPropertyValue('gap')) || 20

    cardElement.style.gridRowEnd = `span ${Math.ceil((scaledHeight + 6 + gridGap) / (gridRowHeight + gridGap))}`
  }

  function packAllGalleryCards() {
    document.querySelectorAll('.gallery-masonry').forEach(gridContainer => {
      const gridStyles = getComputedStyle(gridContainer)
      gridContainer.querySelectorAll('.gallery-card').forEach(card => packGalleryCard(card, gridStyles))
    })
  }

  function hydrateMediaCards(rootElement) {
    if (!rootElement) return
    
    rootElement.querySelectorAll('.gallery-card').forEach(cardElement => {
      const imageElement = cardElement.querySelector('img')
      const videoElement = cardElement.querySelector('video')

      if (imageElement) {
        const packCallback = () => packGalleryCard(cardElement)
        imageElement.complete && imageElement.naturalWidth ? packCallback() : imageElement.addEventListener('load', packCallback)

        if (imageElement.dataset.animSrc) {
          const stillSource = imageElement.src
          cardElement.addEventListener('mouseenter', () => { imageElement.src = imageElement.dataset.animSrc })
          cardElement.addEventListener('mouseleave', () => { imageElement.src = stillSource })
          imageElement.addEventListener('error',     () => { imageElement.src = stillSource })
        }
      } else if (videoElement) {
        packGalleryCard(cardElement)
        videoElement.addEventListener('loadedmetadata', () => packGalleryCard(cardElement))

        cardElement.addEventListener('mouseenter', () => {
          if (videoElement.dataset.animSrc && !videoElement.src) videoElement.src = videoElement.dataset.animSrc
          videoElement.play().catch(() => {})
        })
        cardElement.addEventListener('mouseleave', () => {
          videoElement.pause()
        })
      } else {
        packGalleryCard(cardElement)
      }
    })
  }

  // ==================================================================================================== //
  // CARD BUILDERS
  // ==================================================================================================== //
  function buildMediaBlockHtml(fileData) {
    const sourceUrl = getMediaUrl(fileData.path)
    const thumbUrl  = getThumbUrl(fileData.path)
    const fileName  = fileData.name || fileData.path.split('/').pop()
    
    if (!sourceUrl && !thumbUrl) return ''
    
    const accentName = getNextAccent()
    const isVideo    = EXT_VIDEO.test(fileName)
    const isImage    = EXT_IMAGE.test(fileName)
    const isAnimated = EXT_ANIM.test(fileName)

    if (isImage) {
      const imageSrc = isAnimated ? sourceUrl : (thumbUrl || sourceUrl)

      return `
        <div class="gallery-card" style="--accent: var(--ctp-${accentName}-rgb);" 
             onclick="PawchivePlugin.openLightbox('${escapeHtml(sourceUrl)}', 'img', '${escapeHtml(thumbUrl)}')">
          ${isAnimated ? `
            <span class="card-tag" style="left:auto; right:10px;">
              <span>GIF</span>
            </span>` : ''}
          <img referrerpolicy="no-referrer" decoding="async"
               src="${escapeHtml(imageSrc)}"
               data-full="${escapeHtml(sourceUrl)}"
               alt="${escapeHtml(fileName)}"
               onload="PawchivePlugin.packGalleryCard(this.closest('.gallery-card'))"
               onerror="if(this.dataset.full && this.src !== this.dataset.full){this.src=this.dataset.full;}">
        </div>`
    }
    
    if (isVideo) {
      return `
        <div class="gallery-card" style="--accent: var(--ctp-${accentName}-rgb);">
          <span class="card-tag" style="left:auto; right:10px; cursor:pointer; pointer-events:auto;" 
                onclick="PawchivePlugin.openLightbox('${escapeHtml(sourceUrl)}', 'video')" title="Fullscreen Lightbox">
            <span><i class="fa-solid fa-expand"></i></span>
          </span>
          <video controls loop playsinline preload="metadata" referrerpolicy="no-referrer"
                 poster="${escapeHtml(thumbUrl)}"
                 src="${escapeHtml(sourceUrl)}"
                 onloadedmetadata="PawchivePlugin.packGalleryCard(this.closest('.gallery-card'))">
          </video>
        </div>`
    }
    
    return ''
  }

  function buildZipCardHtml(fileData) {
    const targetUrl = getMediaUrl(fileData.path)
    const fileName  = fileData.name || fileData.path.split('/').pop()
    const sizeHtml  = fileData.size ? `<span style="opacity:0.7">(${formatSize(fileData.size)})</span>` : ''
    
    return `
      <div class="zip-card" data-pawchive-open-zip="${escapeHtml(targetUrl)}" data-pawchive-zip-name="${escapeHtml(fileName)}">
        <div class="zip-icon"><i class="fa-solid fa-file-zipper"></i></div>
        <div style="flex:1; min-width:0;">
          <div class="zip-name">${escapeHtml(fileName)} ${sizeHtml}</div>
          <div class="zip-sub">Click to view contents</div>
        </div>
        <a class="btn" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener" download style="z-index:2;"
           onclick="event.stopPropagation()"><span><i class="fa-solid fa-download"></i></span></a>
      </div>`
  }

  function buildGalleryCardHtml(postData) {
    const filesList = [postData.file, ...(postData.attachments || [])].filter(Boolean)
    const mediaFile = filesList.find(file => EXT_IMAGE.test(getFileName(file)) || EXT_VIDEO.test(getFileName(file))) || postData.file
    const isVideo   = mediaFile && EXT_VIDEO.test(getFileName(mediaFile))
    const hasZip    = filesList.some(file => EXT_ZIP.test(getFileName(file)))
    const fileSize  = mediaFile?.size || 0
    const fileDate  = new Date(postData.published).getTime() || Date.now()
    const fileName  = postData.title || getFileName(mediaFile) || 'Untitled'
    const fileType  = isVideo ? 'video' : 'image'

    let mediaHtml = ''
    if (mediaFile?.path && isVideo) {
      mediaHtml = `
        <video loading="lazy" preload="none" referrerpolicy="no-referrer" loop muted playsinline
               poster="${escapeHtml(getThumbUrl(mediaFile.path))}" 
               data-anim-src="${escapeHtml(getMediaUrl(mediaFile.path))}"></video>`
    } else if (mediaFile?.path && EXT_IMAGE.test(getFileName(mediaFile))) {
      const animAttribute = EXT_ANIM.test(getFileName(mediaFile)) ? `data-anim-src="${escapeHtml(getMediaUrl(mediaFile.path))}"` : ''
      mediaHtml = `
        <img loading="lazy" decoding="async" referrerpolicy="no-referrer"
             src="${escapeHtml(getThumbUrl(mediaFile.path))}" 
             alt="${escapeHtml(postData.title || '')}" ${animAttribute}>`
    } else {
      mediaHtml = `
        <div class="placeholder-media">
          <i class="fa-regular fa-file-lines"></i>
          <span>No Visual Media</span>
        </div>`
    }

    const zipTagHtml = hasZip ? `
      <span class="card-tag" style="left:auto; right:10px; color:rgb(var(--ctp-yellow-rgb)); border-color:rgb(var(--ctp-yellow-rgb));">
        <span><i class="fa-solid fa-file-zipper"></i></span>
      </span>` : ''

    return `
      <div class="gallery-card" style="--accent: var(--ctp-${getNextAccent()}-rgb);"
           data-pawchive-open-post 
           data-service="${escapeHtml(postData.service)}" 
           data-creator="${escapeHtml(postData.user)}" 
           data-post="${escapeHtml(postData.id)}"
           data-name="${escapeHtml(fileName)}" 
           data-size="${fileSize}" 
           data-date="${fileDate}" 
           data-type="${fileType}">
        <span class="card-tag"><span>${escapeHtml(postData.service)}</span></span>
        ${mediaHtml}
        ${zipTagHtml}
      </div>`
  }

  function buildFolderCardHtml(profileData, profileName) {
    return `
      <div class="folder-card" style="--accent: var(--ctp-${getNextAccent()}-rgb)" 
           data-pawchive-open-creator="${escapeHtml(profileData.service)}/${escapeHtml(profileData.id)}"
           data-name="${escapeHtml(profileName)}"
           data-size="${profileData.fav || 0}"
           data-date="${Date.now()}"
           data-type="folder">
        <div class="folder-tab">
          <span class="file-count"><i class="fa-solid fa-user"></i> ${escapeHtml(profileData.service)}</span>
        </div>
        <div class="folder-body">
          <div class="folder-preview">
            <img loading="lazy" decoding="async" referrerpolicy="no-referrer"
                 src="${escapeHtml(getBannerUrl(profileData.service, profileData.id))}" 
                 alt="${escapeHtml(profileName)} banner"
                 data-fallback="${escapeHtml(getIconUrl(profileData.service, profileData.id))}" 
                 data-step="banner"
                 onerror="if(this.dataset.step === 'banner') { this.dataset.step = 'icon'; this.src = this.dataset.fallback; } else if (this.dataset.step === 'icon') { this.dataset.step = 'none'; this.outerHTML = '<div class=&quot;folder-preview-icon&quot;><i class=&quot;fa-solid fa-user&quot;></i></div>'; }">
          </div>
          <div class="folder-info">
            <h3 class="folder-title"><span>${escapeHtml(profileName)}</span></h3>
            <span class="folder-size"><i class="fa-solid fa-star"></i> ${profileData.fav}</span>
          </div>
        </div>
      </div>`
  }

  // ==================================================================================================== //
  // POST CONTROLS
  // ==================================================================================================== //
  function closePostModal() {
    const modalElement = document.getElementById('pawchive-post-modal')
    if (modalElement) modalElement.hidden = true
  }

  function openPostModalContainer() {
    const modalElement = document.getElementById('pawchive-post-modal')
    if (modalElement) modalElement.hidden = false
  }

  async function openPostDetailsModal(service, id, postId) {
    openPostModalContainer()
    
    const modalBody = document.getElementById('pawchiveModalBody')
    if (!modalBody) return
    modalBody.innerHTML = generateLoadingHtml()

    let postData
    try {
      postData = await fetchApi(`/${service}/user/${id}/post/${postId}`)
    } catch (error) {
      modalBody.innerHTML = generateEmptyHtml(error.message, 'fa-triangle-exclamation')
      return
    }
    
    if (!postData) {
      modalBody.innerHTML = generateEmptyHtml('Post not found.', 'fa-file-circle-xmark')
      return
    }

    const filesList   = [...(postData.file?.path ? [postData.file] : []), ...(postData.attachments || [])]
    const uniqueFiles = [...new Map(filesList.map(file => [file.path, file])).values()]

    const autoDownloadEnabled = localStorage.getItem('auto_dl_on') === '1' || localStorage.getItem('pawchive_auto_dl') === 'true'
    const allowedExtensions   = (localStorage.getItem('auto_dl_exts') || localStorage.getItem('pawchive_auto_dl_exts') || 'png, mp4, zip')
      .toLowerCase().split(',').map(str => str.trim()).filter(Boolean)

    if (autoDownloadEnabled && allowedExtensions.length) {
      for (const file of uniqueFiles) {
        const fileExtension = (file.name || file.path).split('.').pop().toLowerCase()
        if (!allowedExtensions.includes(fileExtension) || file._dl) continue
        file._dl = true

        const fallbackUrl = getThumbUrl(file.path)
        
        const triggerDownload = (source, retry = false) => fetch(source)
          .then(response => {
            if (!response.ok && !retry && fallbackUrl) return triggerDownload(fallbackUrl, true)
            if (!response.ok) throw new Error('Failed to fetch media')
            return response.blob()
          })
          .then(blobData => {
            if (!blobData) return
            const objectUrl = URL.createObjectURL(blobData)
            const linkElement = Object.assign(document.createElement('a'), {
              href:     objectUrl,
              download: file.name || file.path.split('/').pop()
            })
            document.body.appendChild(linkElement)
            linkElement.click()
            linkElement.remove()
            setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
          })
          .catch(() => { if (!retry && fallbackUrl) triggerDownload(fallbackUrl, true) })

        triggerDownload(getMediaUrl(file.path))
      }
    }

    const zipFiles    = uniqueFiles.filter(file => EXT_ZIP.test(file.name || file.path))
    const visualFiles = uniqueFiles.filter(file => !EXT_ZIP.test(file.name || file.path))

    const embedHtml = postData.embed && Object.keys(postData.embed).length
      ? `<div class="post-content" style="font-size:.85rem"><i class="fa-solid fa-link"></i> Embed:
           <a href="${escapeHtml(postData.embed.url || '#')}" target="_blank" rel="noopener">${escapeHtml(postData.embed.url || JSON.stringify(postData.embed))}</a>
         </div>`
      : ''

    const contentHtml = postData.content ? sanitizeHtml(postData.content).trim() : ''
    let hasContent    = false
    
    if (contentHtml) {
      const probeElement = document.createElement('div')
      probeElement.innerHTML = contentHtml
      hasContent = probeElement.textContent.trim().length > 0 || !!probeElement.querySelector('img, video, iframe')
    }

    const visualHtml = visualFiles.length
      ? `<div class="gallery-masonry" id="postModalMasonry" style="margin-bottom: 24px;">${visualFiles.map(buildMediaBlockHtml).join('')}</div>`
      : ''
      
    const zipHtml = zipFiles.length
      ? `<div class="zip-container">${zipFiles.map(buildZipCardHtml).join('')}</div>`
      : ''

    modalBody.innerHTML = `
      <h2>${escapeHtml(postData.title || '(untitled)')}</h2>
      
      <div class="modal-meta">
        ${generateBadgeHtml(postData.service)}
        <span><i class="fa-solid fa-calendar-days"></i> ${formatDate(postData.published)}</span>
        ${postData.edited ? `<span><i class="fa-solid fa-pen-to-square"></i> ${formatDate(postData.edited)}</span>` : ''}
        <span>#${escapeHtml(postData.id)}</span>
        <a href="javascript:void(0)" onclick="PawchivePlugin.selectCreator('${escapeHtml(service)}', '${escapeHtml(id)}')">
          <i class="fa-solid fa-user"></i> ${escapeHtml(id)}
        </a>
      </div>

      ${visualHtml}
      ${visualHtml && zipHtml ? '<hr class="zip-container-divider">' : ''}
      ${zipHtml}

      ${embedHtml}
      ${hasContent ? `<div class="post-content">${contentHtml}</div>` : ''}

      <div class="modal-tabs">
        <button class="chip active" data-ptab="comments"><span><i class="fa-solid fa-comments"></i> Comments</span></button>
        <button class="chip" data-ptab="revisions"><span><i class="fa-solid fa-clock-rotate-left"></i> Revisions</span></button>
      </div>
      
      <div id="pawchiveModalTabContent">${generateLoadingHtml()}</div>

      <div class="modal-nav">
        <button class="btn" id="prevPostBtn" ${!postData.prev ? 'disabled' : ''}><span><i class="fa-solid fa-chevron-left"></i> Previous</span></button>
        <button class="btn" id="nextPostBtn" ${!postData.next ? 'disabled' : ''}><span>Next <i class="fa-solid fa-chevron-right"></i></span></button>
      </div>`

    modalBody.querySelectorAll('.post-content img').forEach(img => {
      img.addEventListener('click', () => openLightbox(img.src, 'img'))
    })

    modalBody.querySelectorAll('.modal-tabs .chip').forEach(btn => {
      btn.addEventListener('click', () => {
        modalBody.querySelectorAll('.modal-tabs .chip').forEach(b => b.classList.toggle('active', b === btn))
        loadPostInnerTab(btn.dataset.ptab, service, id, postId)
      })
    })

    if (postData.prev) {
      document.getElementById('prevPostBtn')?.addEventListener('click', () => openPostDetailsModal(service, id, postData.prev))
    }
    if (postData.next) {
      document.getElementById('nextPostBtn')?.addEventListener('click', () => openPostDetailsModal(service, id, postData.next))
    }

    if (visualFiles.length) {
      const masonryElement = modalBody.querySelector('#postModalMasonry')
      hydrateMediaCards(masonryElement)
      requestAnimationFrame(() => masonryElement.querySelectorAll('.gallery-card').forEach(card => packGalleryCard(card)))
      setTimeout(() => masonryElement.querySelectorAll('.gallery-card').forEach(card => packGalleryCard(card)), 150)
    }
    
    loadPostInnerTab('comments', service, id, postId)
  }

  async function loadPostInnerTab(tabName, service, id, postId) {
    const boxContainer = document.getElementById('pawchiveModalTabContent')
    if (!boxContainer) return
    boxContainer.innerHTML = generateLoadingHtml()

    try {
      if (tabName === 'comments') {
        const commentList = await fetchApi(`/${service}/user/${id}/post/${postId}/comments`)
        boxContainer.innerHTML = commentList?.length
          ? commentList.map(c => `
              <div class="comment">
                <div class="item-head"><i class="fa-solid fa-user"></i> ${escapeHtml(c.commenter)} · ${formatDate(c.published)}</div>
                <div>${escapeHtml(c.content)}</div>
                ${(c.revisions || []).map(r => `
                  <div class="comment-rev"><i class="fa-solid fa-pen-to-square"></i> rev ${r.id}: “${escapeHtml(r.content)}”
                     <span style="opacity:.7">(${formatDate(r.added)})</span>
                  </div>`).join('')}
              </div>`).join('')
          : generateEmptyHtml('No comments found.', 'fa-comments')
      } else {
        const revisionList = await fetchApi(`/${service}/user/${id}/post/${postId}/revisions`)
        boxContainer.innerHTML = revisionList?.length
          ? revisionList.map(r => `
              <div class="revision">
                <div class="item-head"><i class="fa-solid fa-clock-rotate-left"></i> revision <b>#${r.revision_id}</b> · archived ${formatDate(r.added)}</div>
                <div>${escapeHtml(r.title || '')}</div>
              </div>`).join('')
          : generateEmptyHtml('No revisions found.', 'fa-clock-rotate-left')
      }
    } catch (error) {
      boxContainer.innerHTML = generateEmptyHtml(error.message, 'fa-triangle-exclamation')
    }
  }

  // ==================================================================================================== //
  // CREATOR PROFILE & CHIP BAR
  // ==================================================================================================== //
  function updateCreatorTagsChipBar(tagsList = []) {
    const chipContainer = document.querySelector('.chip-container')
    if (!chipContainer) return

    chipContainer.innerHTML = ''

    if (creatorState.service && creatorState.id) {
      const exitChip = document.createElement('button')
      exitChip.className = 'chip'
      exitChip.id = 'pawchiveExitCreatorChip'
      exitChip.style.borderColor = 'rgb(var(--ctp-red-rgb))'
      exitChip.style.color       = 'rgb(var(--ctp-red-rgb))'
      exitChip.innerHTML = `<span><i class="fa-solid fa-arrow-left"></i> All Creators</span>`
      
      exitChip.addEventListener('click', (event) => {
        event.stopPropagation()
        clearCreatorSelection()
      })
      chipContainer.appendChild(exitChip)

      const allTagChip = document.createElement('button')
      allTagChip.className   = `chip ${!creatorState.tag ? 'active' : ''}`
      allTagChip.dataset.tag = ''
      allTagChip.innerHTML   = `<span><i class="fa-solid fa-filter"></i> All</span>`
      
      allTagChip.addEventListener('click', () => {
        creatorState.tag = ''
        chipContainer.querySelectorAll('.chip[data-tag]').forEach(b => b.classList.toggle('active', b === allTagChip))
        resetAndFetchPostsData()
      })
      chipContainer.appendChild(allTagChip)

      tagsList.forEach(tagData => {
        const tagChip = document.createElement('button')
        tagChip.className   = `chip ${creatorState.tag === tagData.tag ? 'active' : ''}`
        tagChip.dataset.tag = tagData.tag
        tagChip.innerHTML   = `<span><i class="fa-solid fa-tag"></i> ${escapeHtml(tagData.tag)} (${tagData.post_count})</span>`
        
        tagChip.addEventListener('click', () => {
          creatorState.tag = tagData.tag
          chipContainer.querySelectorAll('.chip[data-tag]').forEach(b => b.classList.toggle('active', b === tagChip))
          resetAndFetchPostsData()
        })
        chipContainer.appendChild(tagChip)
      })
    } else {
      const allPostsChip = document.createElement('button')
      allPostsChip.className      = 'chip active'
      allPostsChip.dataset.folder = 'all'
      allPostsChip.innerHTML      = `<span><i class="fa-solid fa-images"></i> All Posts</span>`
      chipContainer.appendChild(allPostsChip)
    }
  }

  async function renderCreatorHeroDisplay(service, id) {
    const heroContainer = document.getElementById('pawchive-creator-hero-container')
    if (!heroContainer) return

    heroContainer.style.display = ''
    heroContainer.innerHTML     = generateLoadingHtml()

    const [profileData, linksData] = await Promise.all([
      fetchApi(`/${service}/user/${id}/profile`),
      fetchApi(`/${service}/user/${id}/links`).catch(() => [])
    ])

    if (!profileData) {
      heroContainer.innerHTML = generateEmptyHtml('Creator not found.', 'fa-user-slash')
      return
    }

    creatorState.profile = profileData
    creatorState.links   = linksData || []
    creatorState.name    = profileData.name || id

    const initialCharacter = (profileData.name || id || '?').trim()[0].toUpperCase()
    
    const linksHtml = linksData?.length
      ? `<div class="link-chips">
           ${linksData.map(l => `
             <a class="chip" href="javascript:void(0)" onclick="PawchivePlugin.selectCreator('${escapeHtml(l.service)}', '${escapeHtml(l.id)}')">
               <span><i class="fa-solid fa-link"></i> ${escapeHtml(l.service)} · ${escapeHtml(l.name || l.id)}</span>
             </a>`).join('')}
         </div>`
      : ''

    const autoDownloadOn   = localStorage.getItem('auto_dl_on') === '1' || localStorage.getItem('pawchive_auto_dl') === 'true'
    const autoDownloadExts = localStorage.getItem('auto_dl_exts') || localStorage.getItem('pawchive_auto_dl_exts') || 'png, mp4, zip'

    heroContainer.innerHTML = `
      <section class="creator-hero">
        <div class="creator-banner">
          <img src="${escapeHtml(getBannerUrl(service, id))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">
        </div>
        <div class="creator-hero-row">
          <img class="creator-avatar" src="${escapeHtml(getIconUrl(service, id))}" alt="" referrerpolicy="no-referrer"
               onerror="this.outerHTML='<div class=&quot;creator-avatar-fallback&quot;>${escapeHtml(initialCharacter)}</div>'">
          
          <div class="creator-hero-text">
            <h1>${generateBadgeHtml(service)} <span class="creator-name-text">${escapeHtml(profileData.name || id)}</span></h1>
            <div class="creator-stats">
              <span><i class="fa-solid fa-id-card"></i> <b>${escapeHtml(id)}</b></span>
              <span><i class="fa-solid fa-calendar-days"></i> indexed <b>${formatDate(profileData.indexed)}</b></span>
              <span><i class="fa-solid fa-arrow-rotate-right"></i> updated <b>${formatDate(profileData.updated)}</b></span>
            </div>
          </div>
          
          <div class="auto-dl-container">
            <div class="auto-dl-title"><i class="fa-solid fa-robot"></i> Download from Post</div>
            <div class="auto-dl-inputs">
              <label class="switch" title="Toggle Auto-Download on profile load">
                <input type="checkbox" id="heroAutoDlToggle" ${autoDownloadOn ? 'checked' : ''}>
                <span class="slider"></span>
              </label>
              <input type="text" id="heroAutoDlExts" placeholder="png, mp4, zip" value="${escapeHtml(autoDownloadExts)}" title="Comma separated extensions">
            </div>
          </div>
        </div>
        
        ${linksHtml}
        
        <div class="creator-tabbar">
          <div class="sort-pill" id="creatorTabs">
            <div class="sort-slider"><span></span></div>
            <button class="sort-option active" data-ctab="posts"><i class="fa-solid fa-images"></i> <span>Posts</span></button>
            <button class="sort-option" data-ctab="announcements"><i class="fa-solid fa-bullhorn"></i> <span>Announcements</span></button>
            <button class="sort-option" data-ctab="fancards"><i class="fa-solid fa-id-card"></i> <span>Fancards</span></button>
          </div>
        </div>
      </section>
      
      <div id="pawchiveCreatorTabContent" style="display:none; margin-bottom:24px;"></div>`

    document.getElementById('heroAutoDlToggle')?.addEventListener('change', event => {
      const isEnabled = event.target.checked
      localStorage.setItem('auto_dl_on', isEnabled ? '1' : '0')
      localStorage.setItem('pawchive_auto_dl', isEnabled ? 'true' : 'false')
      
      if (window.SettingsAPI?.updateSetting) {
        window.SettingsAPI.updateSetting('pawchiveAutoDlToggle', { default: isEnabled })
      }
    })

    document.getElementById('heroAutoDlExts')?.addEventListener('input', event => {
      const extensionList = event.target.value
      localStorage.setItem('auto_dl_exts', extensionList)
      localStorage.setItem('pawchive_auto_dl_exts', extensionList)
      
      if (window.SettingsAPI?.updateSetting) {
        window.SettingsAPI.updateSetting('pawchiveAutoDlExts', { default: extensionList })
      }
    })

    const creatorTabsContainer = document.getElementById('creatorTabs')
    const tabsSliderIndicator  = creatorTabsContainer?.querySelector('.sort-slider')
    
    const synchronizeTabsSlider = () => {
      const activeOption = creatorTabsContainer?.querySelector('.sort-option.active')
      if (!activeOption || !tabsSliderIndicator) return
      
      tabsSliderIndicator.style.width     = activeOption.offsetWidth + 'px'
      tabsSliderIndicator.style.transform = `translateX(${activeOption.offsetLeft}px)`
    }

    creatorTabsContainer?.querySelectorAll('.sort-option').forEach(button => {
      button.addEventListener('click', () => {
        creatorTabsContainer.querySelectorAll('.sort-option').forEach(b => b.classList.toggle('active', b === button))
        creatorState.tab = button.dataset.ctab
        synchronizeTabsSlider()
        loadCreatorSubTabContent()
      })
    })

    requestAnimationFrame(synchronizeTabsSlider)
    loadCreatorSubTabContent()
  }

  async function loadCreatorSubTabContent() {
    const subContentContainer = document.getElementById('pawchiveCreatorTabContent')
    const globalFilterPanel   = document.querySelector('.filter-panel')
    const globalMasonryGrid   = document.querySelector('.gallery-masonry')
    if (!subContentContainer) return

    if (creatorState.tab === 'posts') {
      subContentContainer.style.display = 'none'
      subContentContainer.innerHTML     = ''
      if (globalFilterPanel) globalFilterPanel.classList.remove('pawchive-hide')
      if (globalMasonryGrid) globalMasonryGrid.classList.remove('pawchive-hide')

      const profileTags = await fetchApi(`/${creatorState.service}/user/${creatorState.id}/tags`).catch(() => [])
      updateCreatorTagsChipBar(profileTags || [])
      resetAndFetchPostsData()
      
    } else if (creatorState.tab === 'announcements') {
      if (globalFilterPanel) globalFilterPanel.classList.add('pawchive-hide')
      if (globalMasonryGrid) globalMasonryGrid.classList.add('pawchive-hide')
      
      subContentContainer.style.display = 'block'
      subContentContainer.innerHTML     = generateLoadingHtml()

      const announcementsList = await fetchApi(`/${creatorState.service}/user/${creatorState.id}/announcements`)
      subContentContainer.innerHTML = announcementsList?.length
        ? announcementsList.map(a => `
            <div class="announcement">
              <div class="item-head"><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(a.service)} · ${formatDate(a.added)}</div>
              <div class="post-content">${sanitizeHtml(a.content)}</div>
            </div>`).join('')
        : generateEmptyHtml('No announcements.', 'fa-bullhorn')
        
    } else if (creatorState.tab === 'fancards') {
      if (globalFilterPanel) globalFilterPanel.classList.add('pawchive-hide')
      if (globalMasonryGrid) globalMasonryGrid.classList.add('pawchive-hide')
      
      subContentContainer.style.display = 'block'

      if (creatorState.service !== 'fanbox') {
        subContentContainer.innerHTML = `
          <div class="notice" style="margin-bottom:20px; padding:14px 18px; background:rgba(var(--ctp-red-rgb),0.1); border:2px solid rgb(var(--ctp-red-rgb)); border-radius:12px; color:rgb(var(--ctp-red-rgb));">
            <i class="fa-solid fa-triangle-exclamation"></i> Fancards are only available for <b>fanbox</b> creators.
          </div>`
        return
      }
      
      subContentContainer.innerHTML = generateLoadingHtml()
      
      const fancardsList = await fetchApi(`/${creatorState.service}/user/${creatorState.id}/fancards`)
      subContentContainer.innerHTML = fancardsList?.length
        ? `<p class="view-sub" style="margin-bottom:16px; color:rgb(var(--ctp-subtext0-rgb));">${fancardsList.length} fancard(s)</p>
           <div class="fancard-grid">
             ${fancardsList.map(c => {
               const relativePath = `/${c.hash.slice(0, 2)}/${c.hash.slice(2, 4)}/${c.hash}${c.ext}`
               return `<img loading="lazy" referrerpolicy="no-referrer" src="${escapeHtml(getThumbUrl(relativePath))}" alt=""
                            onclick="PawchivePlugin.openLightbox('${escapeHtml(getThumbUrl(relativePath))}', 'img')">`
             }).join('')}
           </div>`
        : generateEmptyHtml('No fancards.', 'fa-id-card')
    }
  }

  // ==================================================================================================== //
  // HASH SEARCH
  // ==================================================================================================== //
  async function renderHashLookupResults(hashValue) {
    const masonryContainer = document.querySelector('.gallery-masonry')
    const heroContainer    = document.getElementById('pawchive-creator-hero-container')
    
    if (heroContainer) heroContainer.innerHTML = ''
    if (!masonryContainer) return

    masonryContainer.innerHTML = generateLoadingHtml()

    try {
      const resultData = await fetchApi(`/search_hash/${encodeURIComponent(hashValue)}`)
      if (!resultData) {
        masonryContainer.innerHTML = generateEmptyHtml('File not found.', 'fa-file-circle-xmark')
        return
      }

      const discordPostsHtml = resultData.discord_posts?.length
        ? `<h3 class="section-title"><i class="fa-brands fa-discord"></i> Discord posts (${resultData.discord_posts.length})</h3>
           ${resultData.discord_posts.map(post => `
             <div class="revision">
               <div class="item-head"><i class="fa-brands fa-discord"></i> #${escapeHtml(post.id)} · server ${escapeHtml(post.server)} · channel ${escapeHtml(post.channel)} · ${formatDate(post.published)}</div>
               ${(post.attachments || []).map(a =>
                 `<div><a href="${escapeHtml(getMediaUrl(a.path))}" target="_blank" rel="noopener"><i class="fa-solid fa-paperclip"></i> ${escapeHtml(a.name)}</a></div>`).join('')}
             </div>`).join('')}`
        : ''

      masonryContainer.innerHTML = `
        <div style="grid-column: 1 / -1;">
          <div class="hash-result">
            <dl>
              <dt>Hash</dt><dd>${escapeHtml(resultData.hash)}</dd>
              <dt>Type</dt><dd>${escapeHtml(resultData.mime)} · ${escapeHtml(resultData.ext)}</dd>
              <dt>Size</dt><dd>${(resultData.size / 1048576).toFixed(2)} MiB</dd>
              <dt>Added</dt><dd>${formatDate(resultData.added)}</dd>
            </dl>
          </div>
          <h3 class="section-title"><i class="fa-solid fa-images"></i> Posts containing this file (${(resultData.posts || []).length})</h3>
          <div class="gallery-masonry" id="hashPosts">${(resultData.posts || []).map(buildGalleryCardHtml).join('')}</div>
          ${discordPostsHtml}
        </div>`

      hydrateMediaCards(masonryContainer)
    } catch (error) {
      masonryContainer.innerHTML = generateEmptyHtml(error.message, 'fa-triangle-exclamation')
      triggerToast(error.message)
    }
  }

  // ==================================================================================================== //
  // CREATORS & POSTS DATA
  // ==================================================================================================== //
  async function fetchNextCreatorsDataBatch() {
    if (isLoadingCreators || !hasMoreCreators) return
    isLoadingCreators = true

    try {
      const query            = currentCreatorsSearchQuery.toLowerCase().trim()
      const completeList     = (await fetchCreatorsList()).filter(group => !query || group.name.toLowerCase().includes(query) || group.profiles.some(profile => profile.service.includes(query)))
      const folderGrid       = document.querySelector('.folder-grid')
      
      if (!folderGrid) return

      if (!creatorsDataOffset) {
        folderGrid.innerHTML = ''
        if (!completeList.length) {
          folderGrid.innerHTML = generateEmptyHtml('No creators match.')
          hasMoreCreators      = false
          return
        }
      }

      const currentBatch    = completeList.slice(creatorsDataOffset, creatorsDataOffset + STEP_SIZE)
      const temporaryHolder = document.createElement('div')
      
      temporaryHolder.innerHTML = currentBatch.map(group => buildFolderCardHtml(group.profiles[0], group.name)).join('')
      ;[...temporaryHolder.children].forEach(element => folderGrid.appendChild(element))

      creatorsDataOffset += currentBatch.length
      hasMoreCreators     = creatorsDataOffset < completeList.length
    } catch (error) {
      triggerToast(error.message)
    } finally {
      isLoadingCreators = false
    }
  }

  async function renderCreatorsGrid(query = '') {
    currentCreatorsSearchQuery = query
    creatorsDataOffset         = 0
    hasMoreCreators            = true
    
    const folderGridContainer  = document.querySelector('.folder-grid')
    if (folderGridContainer) folderGridContainer.innerHTML = generateLoadingHtml()
    
    await fetchNextCreatorsDataBatch()
  }

  async function resetAndFetchPostsData() {
    isLoadingPosts  = false
    postsDataOffset = 0
    hasMorePosts    = true
    
    const masonryContainer = document.querySelector('.gallery-masonry')
    if (masonryContainer) masonryContainer.innerHTML = generateLoadingHtml()
    
    await fetchNextPostsDataBatch()
  }

  async function fetchNextPostsDataBatch() {
    if (isLoadingPosts || !hasMorePosts) return
    isLoadingPosts = true

    const masonryContainer  = document.querySelector('.gallery-masonry')
    const imageCountLabel   = document.querySelector('.image-count')
    if (!masonryContainer) { isLoadingPosts = false; return }

    try {
      const query = (creatorState.service ? creatorState.query : currentPostsSearchQuery).trim()

      if (!creatorState.service && /^[a-f0-9]{64}$/i.test(query)) {
        await renderHashLookupResults(query)
        isLoadingPosts = false
        return
      }

      let requestUrl
      if (creatorState.service && creatorState.id) {
        const queryParam = query ? `&q=${encodeURIComponent(query)}` : ''
        const tagParam   = creatorState.tag ? `&tag=${encodeURIComponent(creatorState.tag)}` : ''
        requestUrl       = `/${creatorState.service}/user/${creatorState.id}?o=${postsDataOffset}${tagParam}${queryParam}`
      } else {
        const queryParam = query ? `&q=${encodeURIComponent(query)}` : ''
        requestUrl       = `/posts?o=${postsDataOffset}${queryParam}`
      }

      const postsList = await fetchApi(requestUrl) || []

      if (!postsDataOffset) masonryContainer.innerHTML = ''

      if (!postsList.length) {
        hasMorePosts = false
        if (!postsDataOffset) masonryContainer.innerHTML = generateEmptyHtml('No posts found.')
        if (imageCountLabel)  imageCountLabel.textContent = `${masonryContainer.children.length} Posts`
        return
      }

      const temporaryHolder     = document.createElement('div')
      temporaryHolder.innerHTML = postsList.map(buildGalleryCardHtml).join('')
      ;[...temporaryHolder.children].forEach(element => masonryContainer.appendChild(element))
      
      hydrateMediaCards(masonryContainer)

      postsDataOffset += postsList.length
      hasMorePosts     = postsList.length === STEP_SIZE
      if (imageCountLabel) imageCountLabel.textContent = `${masonryContainer.children.length} Posts`
    } catch (error) {
      triggerToast(error.message)
      if (!postsDataOffset) masonryContainer.innerHTML = generateEmptyHtml(error.message, 'fa-triangle-exclamation')
    } finally {
      isLoadingPosts = false
    }
  }

  // ==================================================================================================== //
  // NAVIGATION & TAB SWITCHING
  // ==================================================================================================== //
  function selectCreator(service, id) {
    creatorState.service = service
    creatorState.id      = id
    creatorState.tab     = 'posts'
    creatorState.tag     = ''
    creatorState.query   = ''

    closePostModal()
    switchToInterfaceTab(1)

    renderCreatorHeroDisplay(service, id)
  }

  function clearCreatorSelection() {
    creatorState.service = null
    creatorState.id      = null
    creatorState.tab     = 'posts'
    creatorState.tag     = ''
    creatorState.query   = ''
    creatorState.profile = null

    const heroContainer = document.getElementById('pawchive-creator-hero-container')
    if (heroContainer) {
      heroContainer.innerHTML     = ''
      heroContainer.style.display = 'none'
    }
    
    const subContentContainer = document.getElementById('pawchiveCreatorTabContent')
    if (subContentContainer) {
      subContentContainer.innerHTML     = ''
      subContentContainer.style.display = 'none'
    }

    const filterPanel = document.querySelector('.filter-panel')
    if (filterPanel) filterPanel.classList.remove('pawchive-hide')

    const masonryContainer = document.querySelector('.gallery-masonry')
    if (masonryContainer) masonryContainer.classList.remove('pawchive-hide')

    updateCreatorTagsChipBar([])
    resetAndFetchPostsData()
  }

  function switchToInterfaceTab(index) {
    const navigationTabs = document.querySelectorAll('.nav-pill .tab')
    const contentPanels  = document.querySelectorAll('.content > div')
    const contentPanel   = document.querySelector('.content')

    if (contentPanel) {
      scrollCache[getActiveTabName()] = contentPanel.scrollTop
    }

    navigationTabs.forEach((tab, i)   => tab.classList.toggle('active', i === index))
    contentPanels.forEach((panel, i) => panel.classList.toggle('active', i === index))

    if (contentPanel) {
      const newActiveTabName = getActiveTabName()
      contentPanel.scrollTop = scrollCache[newActiveTabName] || 0
      pawchiveLastScrollTop  = contentPanel.scrollTop
    }

    const searchInput = document.querySelector('.search-input')
    if (searchInput) {
      searchInput.value = index === 0 ? currentCreatorsSearchQuery : (creatorState.service ? creatorState.query : currentPostsSearchQuery)
    }

    if (index === 1) {
      packAllGalleryCards()
    }
  }

  function getActiveTabName() {
    const panels = document.querySelectorAll('.content > div')
    if (panels[0]?.classList.contains('active')) return 'creators'
    if (panels[1]?.classList.contains('active')) return 'posts'
    return 'other'
  }

  // ==================================================================================================== //
  // DOM SORTING
  // ==================================================================================================== //
  function handlePawchiveSorting(optionElement) {
    const sortPillContainer = optionElement.closest('.sort-pill')
    if (!sortPillContainer) return

    if (sortPillContainer.id === 'creatorTabs') {
      sortPillContainer.querySelectorAll('.sort-option').forEach(button => button.classList.toggle('active', button === optionElement))
      creatorState.tab = optionElement.dataset.ctab
      
      const sliderIndicator = sortPillContainer.querySelector('.sort-slider')
      if (sliderIndicator) {
        sliderIndicator.style.width     = optionElement.offsetWidth + 'px'
        sliderIndicator.style.transform = `translateX(${optionElement.offsetLeft}px)`
      }
      loadCreatorSubTabContent()
      return
    }

    const sortingOptions  = sortPillContainer.querySelectorAll('.sort-option')
    const sliderIndicator = sortPillContainer.querySelector('.sort-slider')

    const wasActive        = optionElement.classList.contains('active')
    const currentDirection = optionElement.dataset.direction || 'up'
    const newDirection     = wasActive ? (currentDirection === 'up' ? 'down' : 'up') : 'up'
    
    optionElement.dataset.direction = newDirection
    currentSort                     = { key: optionElement.dataset.sort, dir: newDirection }

    sortingOptions.forEach(option => {
      option.classList.remove('active')
      if (option !== optionElement) {
        const iconElement = option.querySelector('i')
        if (iconElement && option.dataset.sort !== 'type') {
          iconElement.classList.remove('fa-arrow-up', 'fa-arrow-down')
          iconElement.classList.add(option.dataset.direction === 'down' ? 'fa-arrow-down' : 'fa-arrow-up')
        }
      }
    })

    optionElement.classList.add('active')
    const iconElement = optionElement.querySelector('i')
    if (iconElement && optionElement.dataset.sort !== 'type') {
      iconElement.classList.remove('fa-arrow-up', 'fa-arrow-down')
      iconElement.classList.add(newDirection === 'down' ? 'fa-arrow-down' : 'fa-arrow-up')
    }

    if (sliderIndicator) {
      sliderIndicator.style.width     = optionElement.offsetWidth + 'px'
      sliderIndicator.style.transform = `translateX(${optionElement.offsetLeft}px)`
    }

    const activeTabName   = getActiveTabName()
    const targetContainer = activeTabName === 'creators' ? document.querySelector('.folder-grid') : document.querySelector('.gallery-masonry')
    if (!targetContainer) return

    const cardElements = Array.from(targetContainer.children)
    cardElements.sort((a, b) => {
      if (currentSort.key === 'type') {
        return (Math.random() > 0.5 ? 1 : -1) * (currentSort.dir === 'up' ? 1 : -1)
      }
      const valueA = a.dataset[currentSort.key] || ''
      const valueB = b.dataset[currentSort.key] || ''
      
      const comparison = (currentSort.key === 'size' || currentSort.key === 'date')
        ? (Number(valueA) || 0) - (Number(valueB) || 0)
        : String(valueA).localeCompare(String(valueB), undefined, { numeric: true, sensitivity: 'base' })
          
      return currentSort.dir === 'up' ? comparison : -comparison
    })

    cardElements.forEach(card => targetContainer.appendChild(card))
    packAllGalleryCards()
  }

  // ==================================================================================================== //
  // EVENT LISTENERS
  // ==================================================================================================== //
  function setupEventListeners() {
    document.addEventListener('click', event => {
      if (!isPawchiveActive) return

      const sortPillElement = event.target.closest('.sort-pill')
      if (sortPillElement && sortPillElement.id !== 'creatorTabs') {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        
        const optionElement = event.target.closest('.sort-option')
        if (optionElement) handlePawchiveSorting(optionElement)
        return
      }

      const navigationTabElement = event.target.closest('.nav-pill .tab')
      if (navigationTabElement) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        const tabsList = Array.from(document.querySelectorAll('.nav-pill .tab'))
        switchToInterfaceTab(tabsList.indexOf(navigationTabElement))
        return
      }

      const postElement = event.target.closest('[data-pawchive-open-post]')
      if (postElement) {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()

        const fullScreenModal = document.querySelector('.full-screen')
        if (fullScreenModal) fullScreenModal.classList.remove('active')

        const { service, creator: uid, post } = postElement.dataset
        openPostDetailsModal(service, uid, post)
        return
      }

      if (event.target.closest('[data-close-pawchive-modal]')) {
        closePostModal()
        event.stopPropagation()
        return
      }
      if (event.target.closest('[data-close-pawchive-zip]')) {
        closeZipModal()
        event.stopPropagation()
        return
      }
      if (event.target.closest('[data-close-pawchive-lightbox]')) {
        closeLightbox()
        event.stopPropagation()
        return
      }

      const zipElement = event.target.closest('[data-pawchive-open-zip]')
      if (zipElement) {
        event.stopPropagation()
        openZipArchive(zipElement.dataset.pawchiveOpenZip, zipElement.dataset.pawchiveZipName)
        return
      }

      const creatorElement = event.target.closest('[data-pawchive-open-creator]')
      if (creatorElement) {
        event.stopPropagation()
        const [service, id] = creatorElement.dataset.pawchiveOpenCreator.split('/')
        selectCreator(service, id)
        return
      }
    }, true)

    document.addEventListener('keydown', event => {
      if (!isPawchiveActive) return

      if (event.key === 'Escape') {
        const lightboxContainer = document.getElementById('pawchive-lightbox')
        const zipModalContainer = document.getElementById('pawchive-zip-modal')
        const postModalContainer = document.getElementById('pawchive-post-modal')

        if (lightboxContainer && !lightboxContainer.hidden) { closeLightbox(); event.stopPropagation() }
        else if (zipModalContainer && !zipModalContainer.hidden) { closeZipModal(); event.stopPropagation() }
        else if (postModalContainer && !postModalContainer.hidden) { closePostModal() }
      }

      if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        event.preventDefault()
        document.querySelector('.search-input')?.focus()
      }
    })

    const searchInput  = document.querySelector('.search-input')
    const searchSubmit = document.querySelector('.search-submit')

    const triggerSearchUpdate = () => {
      const query     = searchInput ? searchInput.value.trim() : ''
      const activeTab = getActiveTabName()

      if (activeTab === 'creators') {
        renderCreatorsGrid(query)
      } else {
        if (creatorState.service) {
          creatorState.query = query
          resetAndFetchPostsData()
        } else {
          currentPostsSearchQuery = query
          resetAndFetchPostsData()
        }
      }
    }

    searchInput?.addEventListener('keydown', event => {
      if (isPawchiveActive && event.key === 'Enter') {
        event.preventDefault()
        event.stopImmediatePropagation()
        triggerSearchUpdate()
      }
    }, true)

    searchInput?.addEventListener('input', () => {
      if (isPawchiveActive && searchInput.value.trim() === '') {
        triggerSearchUpdate()
      }
    })

    searchSubmit?.addEventListener('click', event => {
      if (isPawchiveActive) {
        event.preventDefault()
        event.stopImmediatePropagation()
        triggerSearchUpdate()
      }
    }, true)

    const contentPanel = document.querySelector('.content')
    contentPanel?.addEventListener('scroll', (event) => {
      if (!isPawchiveActive) return
      
      event.stopImmediatePropagation()

      const currentScrollTop = contentPanel.scrollTop
      const scrollDelta      = currentScrollTop - pawchiveLastScrollTop

      const filterPanel      = document.querySelector('.filter-panel')
      const heroContainer    = document.getElementById('pawchive-creator-hero-container')
      
      const heroHeight       = (heroContainer && heroContainer.style.display !== 'none') ? heroContainer.offsetHeight : 0
      const safeThreshold    = Math.max(50, heroHeight)

      if (filterPanel) {
        if (currentScrollTop <= safeThreshold) {
          filterPanel.classList.remove('hidden')
        } else if (scrollDelta > 5) {
          filterPanel.classList.add('hidden')
        } else if (scrollDelta < -5) {
          filterPanel.classList.remove('hidden')
        }
      }

      pawchiveLastScrollTop = currentScrollTop

      const isNearBottom = contentPanel.scrollHeight - currentScrollTop - contentPanel.clientHeight < 800
      if (isNearBottom) {
        const activeTab = getActiveTabName()
        if (activeTab === 'posts' && !isLoadingPosts && hasMorePosts) {
          fetchNextPostsDataBatch()
        } else if (activeTab === 'creators' && !isLoadingCreators && hasMoreCreators) {
          fetchNextCreatorsDataBatch()
        }
      }
    }, { capture: true, passive: false })
  }

  // ==================================================================================================== //
  // SETTINGS & ENDPOINTS
  // ==================================================================================================== //
  function updatePawchiveAutoDl(isEnabled) {
    const booleanValue = Boolean(isEnabled)
    localStorage.setItem('auto_dl_on',       booleanValue ? '1'    : '0')
    localStorage.setItem('pawchive_auto_dl', booleanValue ? 'true' : 'false')
    
    const heroToggle = document.getElementById('heroAutoDlToggle')
    if (heroToggle) heroToggle.checked = booleanValue
  }

  function updatePawchiveAutoDlExts(extensionsList) {
    const stringValue = String(extensionsList || 'png, mp4, zip')
    localStorage.setItem('auto_dl_exts', stringValue)
    localStorage.setItem('pawchive_auto_dl_exts', stringValue)
    
    const heroInput = document.getElementById('heroAutoDlExts')
    if (heroInput) heroInput.value = stringValue
  }

  function updatePawchiveEndpoints(options = {}) {
    if (options.apiBaseUrl) {
      endpointConfig.api = options.apiBaseUrl.replace(/\/$/, '')
      localStorage.setItem('pawchive_api_url', endpointConfig.api)
    }
    if (options.mediaBaseUrl) {
      endpointConfig.data = options.mediaBaseUrl.replace(/\/$/, '')
      localStorage.setItem('pawchive_media_url', endpointConfig.data)
    }
    if (options.thumbnailBaseUrl) {
      endpointConfig.thumb = options.thumbnailBaseUrl.replace(/\/$/, '')
      localStorage.setItem('pawchive_thumb_url', endpointConfig.thumb)
    }
    triggerToast('Pawchive endpoints updated.', true)
  }

  function resetPawchiveEndpoints() {
    endpointConfig.api   = DEFAULT_API_BASE
    endpointConfig.data  = DEFAULT_DATA_BASE
    endpointConfig.thumb = DEFAULT_THUMB_BASE
    
    localStorage.removeItem('pawchive_api_url')
    localStorage.removeItem('pawchive_media_url')
    localStorage.removeItem('pawchive_thumb_url')

    if (window.SettingsAPI?.updateSetting) {
      window.SettingsAPI.updateSetting('pawchiveApiUrl', { default: DEFAULT_API_BASE })
    }
    triggerToast('Endpoints reset to defaults.', true)
  }

  function startUIOverrideObserver() {
    const masonryContainer = document.querySelector('.gallery-masonry')
    const folderContainer  = document.querySelector('.folder-grid')
    
    if (pawchiveUIObserver) return
    
    pawchiveUIObserver = new MutationObserver(mutations => {
      if (!isPawchiveActive) return
      
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType !== 1) return
          
          const isGalleryCard = node.classList.contains('gallery-card')
          const isFolderCard  = node.classList.contains('folder-card')
          
          const isPawchivePost    = node.hasAttribute('data-pawchive-open-post')
          const isPawchiveCreator = node.hasAttribute('data-pawchive-open-creator')
          
          if (isGalleryCard && !isPawchivePost)    node.remove()
          if (isFolderCard  && !isPawchiveCreator) node.remove()
        })
      })
    })
    
    if (masonryContainer) pawchiveUIObserver.observe(masonryContainer, { childList: true })
    if (folderContainer)  pawchiveUIObserver.observe(folderContainer, { childList: true })
  }

  // ==================================================================================================== //
  // PLUGIN TOGGLE
  // ==================================================================================================== //
  async function togglePawchive(enablePlugin) {
    isPawchiveActive = Boolean(enablePlugin)
    localStorage.setItem('pawchive_enabled', isPawchiveActive ? 'true' : 'false')
    
    if (isPawchiveActive) {
      document.body.classList.add('pawchive-active')
    } else {
      document.body.classList.remove('pawchive-active')
    }

    const navigationLabels = document.querySelectorAll('.nav-pill .tab .label')
    const folderGrid       = document.querySelector('.folder-grid')
    const masonryGrid      = document.querySelector('.gallery-masonry')
    const galleryContainer = document.querySelector('.gallery-grid')
    const filterPanel      = document.querySelector('.filter-panel')

    if (isPawchiveActive) {
      injectPluginStyles()
      injectModals()

      if (folderGrid && !originalUIState.folderGridHTML)     originalUIState.folderGridHTML     = folderGrid.innerHTML
      if (masonryGrid && !originalUIState.galleryMasonryHTML) originalUIState.galleryMasonryHTML = masonryGrid.innerHTML

      if (!document.getElementById('pawchive-creator-hero-container') && galleryContainer) {
        const heroWrapper = document.createElement('div')
        heroWrapper.id            = 'pawchive-creator-hero-container'
        heroWrapper.style.display = 'none'
        
        if (filterPanel) {
          galleryContainer.insertBefore(heroWrapper, filterPanel)
        } else {
          galleryContainer.insertBefore(heroWrapper, galleryContainer.firstChild)
        }
      }

      if (navigationLabels[0]) navigationLabels[0].innerHTML = 'Creators'
      if (navigationLabels[1]) navigationLabels[1].innerHTML = 'Posts'

      const searchInput = document.querySelector('.search-input')
      if (searchInput) {
        if (!originalUIState.searchPlaceholder) originalUIState.searchPlaceholder = searchInput.placeholder
        searchInput.placeholder = 'Search string or SHA-256 hash… ( / )'
      }

      creatorState.service = null
      creatorState.id      = null

      startUIOverrideObserver()

      updateCreatorTagsChipBar([])
      await renderCreatorsGrid()
      await resetAndFetchPostsData()
    } else {
      closePostModal()
      closeZipModal()
      closeLightbox()

      const heroWrapper = document.getElementById('pawchive-creator-hero-container')
      if (heroWrapper) heroWrapper.remove()

      if (filterPanel) filterPanel.classList.remove('pawchive-hide')

      if (navigationLabels[0]) navigationLabels[0].textContent = originalUIState.tab1Label
      if (navigationLabels[1]) navigationLabels[1].textContent = originalUIState.tab2Label

      const searchInput = document.querySelector('.search-input')
      if (searchInput && originalUIState.searchPlaceholder) {
        searchInput.placeholder = originalUIState.searchPlaceholder
      }

      if (folderGrid) folderGrid.innerHTML = originalUIState.folderGridHTML
      if (masonryGrid) {
        masonryGrid.classList.remove('pawchive-hide')
        masonryGrid.innerHTML = originalUIState.galleryMasonryHTML
      }

      if (pawchiveUIObserver) {
        pawchiveUIObserver.disconnect()
        pawchiveUIObserver = null
      }

      const chipContainer = document.querySelector('.chip-container')
      if (chipContainer) {
        chipContainer.innerHTML = `<button class="chip active" data-folder="all"><span>All Images</span></button>`
      }

      if (typeof window.loadFoldersFromServer === 'function') {
        try { await window.loadFoldersFromServer() } catch (ignored) {}
      }
    }
  }

  // ==================================================================================================== //
  // INITIALIZATION
  // ==================================================================================================== //
  function initializePlugin() {
    setupEventListeners()

    if (localStorage.getItem('pawchive_enabled') === 'true') {
      togglePawchive(true)
    }

    setInterval(() => {
      const toggleElement = document.getElementById('pawchiveToggle')
      if (toggleElement && toggleElement.dataset.synced !== 'true') {
        toggleElement.checked        = localStorage.getItem('pawchive_enabled') === 'true'
        toggleElement.dataset.synced = 'true'
      }
    }, 300)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePlugin)
  } else {
    initializePlugin()
  }

  window.togglePawchive           = togglePawchive
  window.updatePawchiveAutoDl     = updatePawchiveAutoDl
  window.updatePawchiveAutoDlExts = updatePawchiveAutoDlExts
  window.updatePawchiveEndpoints  = updatePawchiveEndpoints
  window.resetPawchiveEndpoints   = resetPawchiveEndpoints

  return {
    togglePawchive,
    openPostModal:  openPostDetailsModal,
    openZip:        openZipArchive,
    openLightbox,
    closeLightbox,
    closeModal:     closePostModal,
    closeZip:       closeZipModal,
    selectCreator,
    clearCreator:   clearCreatorSelection,
    packGalleryCard,
    packAllGalleryCards,
    updatePawchiveAutoDl,
    updatePawchiveAutoDlExts,
    updatePawchiveEndpoints,
    resetPawchiveEndpoints
  }
})