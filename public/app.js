const state = {
  search: '',
  searchType: 'all',   // Search lookup type: 'all', 'title', 'author', 'publisher', 'isbn'
  sourceTypes: [],     // Checked sources in sidebar: '사서추천', '대학추천'
  age: '',             // Selected target age group (사서추천 subtype)
  library: '',         // Selected library institution (사서추천 subtype)
  university: '',      // Selected university (대학추천 subtype)
  category: '',        // Selected KDC category (from top tabs)
  page: 1,
  limit: 15,
  filters: null,
  // User Authentication & Favorites lists
  user: null,
  token: localStorage.getItem('auth_token') || '',
  favorites: [],
  folders: [],
  readBooks: JSON.parse(localStorage.getItem('read_books') || '[]')
};

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchTypeSelect = document.getElementById('search-type');
const searchBtn = document.getElementById('search-btn');
const searchClearBtn = document.getElementById('search-clear-btn');
const booksListContainer = document.getElementById('books-list');
const totalCountEl = document.getElementById('total-count');
const btnResetAll = document.getElementById('btn-reset-all');
const paginationControls = document.getElementById('pagination-controls');
const btnToggleFilters = document.getElementById('btn-toggle-filters');
const btnCloseSidebar = document.getElementById('btn-close-sidebar');
const filterSidebar = document.getElementById('filter-sidebar');
const btnResetFilters = document.getElementById('btn-reset-filters');
const bookDetailModal = document.getElementById('book-detail-modal');
const btnCloseModal = document.getElementById('btn-close-modal');
const modalContentArea = document.getElementById('modal-content-area');
const btnResetHome = document.getElementById('btn-reset-home');
const categoryTabsContainer = document.getElementById('category-tabs');
const sourceOptionsList = document.getElementById('source-options-list');

// Favorites Drawer DOM Elements
const btnToggleFavoritesDrawer = document.getElementById('btn-toggle-favorites-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const favoritesDrawer = document.getElementById('favorites-drawer');
const drawerUserInfo = document.getElementById('drawer-user-info');
const drawerFavoritesContent = document.getElementById('drawer-favorites-content');
const favoritesTreeContainer = document.getElementById('favorites-tree');
const btnCreateFolder = document.getElementById('btn-create-folder');

// Auth Modal DOM Elements
const authModal = document.getElementById('auth-modal');
const btnCloseAuthModal = document.getElementById('btn-close-auth-modal');
const authTabs = document.querySelectorAll('.auth-tab');
const authErrorMsg = document.getElementById('auth-error-msg');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  await checkAuthOnStartup();
  fetchFilters();
  fetchBooks();
});

// Event Listeners Setup
function setupEventListeners() {
  // Logo home click
  btnResetHome.addEventListener('click', resetAll);

  // Trigger search on submit button click
  searchBtn.addEventListener('click', () => {
    state.search = searchInput.value.trim();
    state.searchType = searchTypeSelect.value;
    state.page = 1;
    fetchBooks();
  });

  // Trigger search on ENTER key inside input
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      state.search = searchInput.value.trim();
      state.searchType = searchTypeSelect.value;
      state.page = 1;
      fetchBooks();
    }
  });

  // Dropdown select change triggers instant search
  searchTypeSelect.addEventListener('change', () => {
    state.searchType = searchTypeSelect.value;
    state.search = searchInput.value.trim();
    state.page = 1;
    fetchBooks();
  });

  // Search input debouncer (400ms) for dynamic typing
  let searchTimeout;
  searchInput.addEventListener('input', (e) => {
    state.search = e.target.value.trim();
    state.searchType = searchTypeSelect.value;
    
    if (state.search) {
      searchClearBtn.classList.remove('hidden');
    } else {
      searchClearBtn.classList.add('hidden');
    }
    
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      state.page = 1;
      fetchBooks();
    }, 400);
  });

  // Clear search input
  searchClearBtn.addEventListener('click', () => {
    searchInput.value = '';
    state.search = '';
    searchClearBtn.classList.add('hidden');
    state.page = 1;
    fetchBooks();
  });

  // Mobile sidebar filter drawer toggle
  btnToggleFilters.addEventListener('click', () => {
    filterSidebar.classList.add('active');
  });

  btnCloseSidebar.addEventListener('click', () => {
    filterSidebar.classList.remove('active');
  });

  // Close sidebar drawer on backdrop click in mobile
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 768) {
      if (!filterSidebar.contains(e.target) && !btnToggleFilters.contains(e.target) && filterSidebar.classList.contains('active')) {
        filterSidebar.classList.remove('active');
      }
    }
  });

  // Recommendation Source Checkboxes in Sidebar
  sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(chk => {
    chk.addEventListener('change', () => {
      // Gather checked values
      const checkedBoxes = Array.from(sourceOptionsList.querySelectorAll('input[name="sourceType"]:checked'));
      state.sourceTypes = checkedBoxes.map(c => c.value);
      
      // Reset mutually exclusive subtypes if parent source is unchecked
      if (!state.sourceTypes.includes('사서추천')) {
        state.age = '';
        state.library = '';
      }
      if (!state.sourceTypes.includes('대학추천')) state.university = '';
      
      state.page = 1;
      renderFilters();
      fetchBooks();
    });
  });

  // Reset Filters button
  btnResetFilters.addEventListener('click', () => {
    state.sourceTypes = [];
    state.age = '';
    state.library = '';
    state.university = '';
    state.page = 1;
    
    // Clear DOM checkboxes for sources
    sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => c.checked = false);
    
    renderFilters();
    fetchBooks();
  });

  // Global reset button
  btnResetAll.addEventListener('click', resetAll);

  // Modal details handlers
  btnCloseModal.addEventListener('click', closeModal);
  bookDetailModal.addEventListener('click', (e) => {
    if (e.target === bookDetailModal) closeModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && bookDetailModal.classList.contains('active')) {
      closeModal();
    }
  });

  // Favorites Drawer Toggle
  btnToggleFavoritesDrawer.addEventListener('click', () => {
    favoritesDrawer.classList.toggle('open');
    if (favoritesDrawer.classList.contains('open') && state.user) {
      fetchFavoritesAndFolders();
    }
  });

  btnCloseDrawer.addEventListener('click', () => {
    favoritesDrawer.classList.remove('open');
  });

  // Show Login Modal Drawer Trigger
  drawerUserInfo.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'btn-show-login-modal-drawer') {
      showAuthModal();
    }
  });

  btnCloseAuthModal.addEventListener('click', closeAuthModal);
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) closeAuthModal();
  });

  // Tab switching in Auth modal
  authTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      authTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const targetForm = tab.dataset.tab;
      authErrorMsg.classList.add('hidden');
      
      if (targetForm === 'login') {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
      } else {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
      }
    });
  });

  // Login form submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = document.getElementById('login-nickname').value.trim();
    const password = document.getElementById('login-password').value;
    
    authErrorMsg.classList.add('hidden');
    
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '로그인에 실패했습니다.');
      
      state.token = data.token;
      localStorage.setItem('auth_token', data.token);
      state.user = data.user;
      
      closeAuthModal();
      updateAuthUI();
      fetchFavoritesAndFolders();
      fetchBooks(); // Refresh list to show active stars
    } catch (err) {
      authErrorMsg.textContent = err.message;
      authErrorMsg.classList.remove('hidden');
    }
  });

  // Register form submit
  registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = document.getElementById('register-nickname').value.trim();
    const password = document.getElementById('register-password').value;
    const passwordConfirm = document.getElementById('register-password-confirm').value;
    
    authErrorMsg.classList.add('hidden');
    
    if (password !== passwordConfirm) {
      authErrorMsg.textContent = '비밀번호가 일치하지 않습니다.';
      authErrorMsg.classList.remove('hidden');
      return;
    }
    
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '회원가입에 실패했습니다.');
      
      state.token = data.token;
      localStorage.setItem('auth_token', data.token);
      state.user = data.user;
      
      closeAuthModal();
      updateAuthUI();
      fetchFavoritesAndFolders();
      fetchBooks();
    } catch (err) {
      authErrorMsg.textContent = err.message;
      authErrorMsg.classList.remove('hidden');
    }
  });

  // Create folder category
  btnCreateFolder.addEventListener('click', async () => {
    const folderName = prompt('새 폴더 이름을 입력하세요:');
    if (!folderName || !folderName.trim()) return;
    
    try {
      const res = await fetch('/api/favorites/folders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ name: folderName.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '폴더 생성 실패');
      
      fetchFavoritesAndFolders();
    } catch (err) {
      alert(err.message);
    }
  });
}

// Reset page completely to default state
function resetAll() {
  state.search = '';
  state.searchType = 'all';
  state.sourceTypes = [];
  state.age = '';
  state.library = '';
  state.university = '';
  state.category = '';
  state.page = 1;

  searchInput.value = '';
  searchTypeSelect.value = 'all';
  searchClearBtn.classList.add('hidden');

  // Reset source checkboxes
  sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => c.checked = false);

  // Reset Category Top Tabs active state
  document.querySelectorAll('.category-tab-btn').forEach(btn => {
    if (btn.dataset.category === '') {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  renderFilters();
  fetchBooks();
  
  if (window.innerWidth <= 768) {
    filterSidebar.classList.remove('active');
  }
}

// Fetch Filter configurations from backend
async function fetchFilters() {
  try {
    const res = await fetch('/api/filters');
    if (!res.ok) throw new Error('API query error');
    state.filters = await res.json();
    
    renderCategoryTabs();
    renderFilters();
  } catch (error) {
    console.error('Error fetching filter options:', error);
    categoryTabsContainer.innerHTML = '<div class="error-text">카테고리 로드 실패</div>';
    document.getElementById('age-options-list').innerHTML = '<div class="error-text">필터 로드 실패</div>';
    document.getElementById('university-options-list').innerHTML = '<div class="error-text">필터 로드 실패</div>';
  }
}

// Render Top Category Tabs
function renderCategoryTabs() {
  if (!state.filters || !state.filters.categories) return;

  let html = `<button class="category-tab-btn active" data-category="">전체 도서</button>`;
  
  state.filters.categories.forEach(cat => {
    html += `<button class="category-tab-btn" data-category="${cat}">${cat}</button>`;
  });

  categoryTabsContainer.innerHTML = html;

  // Bind Category click events
  categoryTabsContainer.querySelectorAll('.category-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      categoryTabsContainer.querySelectorAll('.category-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      state.category = btn.dataset.category;
      state.page = 1;
      fetchBooks();
    });
  });
}

// Render dynamic filter groups (Age targets, Library Institutions, and Universities)
function renderFilters() {
  const ageGroup = document.getElementById('filter-group-age');
  const libGroup = document.getElementById('filter-group-library');
  const univGroup = document.getElementById('filter-group-university');
  
  const ageContainer = document.getElementById('age-options-list');
  const libContainer = document.getElementById('library-options-list');
  const univContainer = document.getElementById('university-options-list');
  
  if (!state.filters) return;
  
  // Decide sidebar filter widgets visibility based on checked source checkboxes
  const showLib = state.sourceTypes.length === 0 || state.sourceTypes.includes('사서추천');
  const showUniv = state.sourceTypes.length === 0 || state.sourceTypes.includes('대학추천');

  if (showLib) {
    ageGroup.classList.remove('hidden');
    libGroup.classList.remove('hidden');
  } else {
    ageGroup.classList.add('hidden');
    libGroup.classList.add('hidden');
  }

  if (showUniv) {
    univGroup.classList.remove('hidden');
  } else {
    univGroup.classList.add('hidden');
  }
  
  const ageSubtypes = ['유아', '초저', '초고', '청소년'];
  const ageDisplayNames = {
    '초저': '초저 (초등저학년)',
    '초고': '초고 (초등고학년)'
  };
  
  // 1. Render Age targets (사서 추천 대상) in age-progression order
  let ageHtml = '';
  ageSubtypes.forEach(sub => {
    if ((state.filters.subtypes['사서추천'] || []).includes(sub)) {
      const checked = state.age === sub ? 'checked' : '';
      const displayVal = ageDisplayNames[sub] || sub;
      ageHtml += createCheckboxRow('age', sub, checked, displayVal);
    }
  });
  ageContainer.innerHTML = ageHtml;
  
  // 1b. Render Library Institutions (추천 기관)
  let libHtml = '';
  (state.filters.subtypes['사서추천'] || []).forEach(sub => {
    if (!ageSubtypes.includes(sub)) {
      const checked = state.library === sub ? 'checked' : '';
      libHtml += createCheckboxRow('library', sub, checked);
    }
  });
  libContainer.innerHTML = libHtml;
  
  // 2. Render Universities (대학 추천 목록)
  let univHtml = '';
  (state.filters.subtypes['대학추천'] || []).forEach(sub => {
    const checked = state.university === sub ? 'checked' : '';
    univHtml += createCheckboxRow('university', sub, checked);
  });
  univContainer.innerHTML = univHtml;
  
  // Setup toggle single-select filters click handlers
  setupFilterClickHandlers(ageContainer, 'age');
  setupFilterClickHandlers(libContainer, 'library');
  setupFilterClickHandlers(univContainer, 'university');
}

// Checkbox input row HTML generator
function createCheckboxRow(name, val, checkedState, displayVal) {
  const label = displayVal || val;
  return `
    <label class="checkbox-label">
      <input type="checkbox" name="${name}" value="${val}" ${checkedState}>
      <span>${label}</span>
    </label>
  `;
}

// Single-select toggle click handler for checkbox arrays
function setupFilterClickHandlers(container, filterKey) {
  container.querySelectorAll(`input[name="${filterKey}"]`).forEach(input => {
    input.addEventListener('click', (e) => {
      const val = e.target.value;
      
      if (state[filterKey] === val) {
        state[filterKey] = '';
        e.target.checked = false;
      } else {
        state[filterKey] = val;
        container.querySelectorAll(`input[name="${filterKey}"]`).forEach(other => {
          if (other !== e.target) other.checked = false;
        });
        
        // Mutually exclusive clearing across age, library, and university
        if (filterKey === 'age') {
          state.library = '';
          state.university = '';
          document.querySelectorAll('input[name="library"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="university"]').forEach(c => c.checked = false);
        } else if (filterKey === 'library') {
          state.age = '';
          state.university = '';
          document.querySelectorAll('input[name="age"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="university"]').forEach(c => c.checked = false);
        } else if (filterKey === 'university') {
          state.age = '';
          state.library = '';
          document.querySelectorAll('input[name="age"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="library"]').forEach(c => c.checked = false);
        }
      }
      
      state.page = 1;
      fetchBooks();
    });
  });
}

// Fetch Recommended Books from API
async function fetchBooks() {
  booksListContainer.innerHTML = '<div class="loading-spinner"></div>';
  
  // Toggle reset button visibility
  if (state.search || state.sourceTypes.length > 0 || state.age || state.library || state.university || state.category) {
    btnResetAll.classList.remove('hidden');
  } else {
    btnResetAll.classList.add('hidden');
  }

  try {
    const params = new URLSearchParams({
      page: state.page,
      limit: state.limit,
      search: state.search,
      searchType: state.searchType,
      category: state.category
    });
    
    // Choose appropriate sourceType parameter
    if (state.sourceTypes.length === 1) {
      params.append('sourceType', state.sourceTypes[0]);
    }
    
    // Choose appropriate subtype parameter
    if (state.sourceTypes.includes('사서추천') && !state.sourceTypes.includes('대학추천')) {
      if (state.age) params.append('subtype', state.age);
      else if (state.library) params.append('subtype', state.library);
    } else if (state.sourceTypes.includes('대학추천') && !state.sourceTypes.includes('사서추천')) {
      if (state.university) params.append('subtype', state.university);
    } else {
      // If both or neither are checked
      if (state.age) params.append('subtype', state.age);
      else if (state.library) params.append('subtype', state.library);
      else if (state.university) params.append('subtype', state.university);
    }
    
    const res = await fetch(`/api/books?${params.toString()}`);
    if (!res.ok) throw new Error('API server returned error');
    
    const data = await res.json();
    totalCountEl.textContent = data.total.toLocaleString();
    
    renderBooksList(data.books);
    renderPagination(data.totalPages, data.page);
  } catch (error) {
    console.error('Error fetching book recommendations:', error);
    booksListContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>도서 목록을 가져오는 데 실패했습니다.</p>
        <button onclick="fetchBooks()" class="btn-secondary" style="margin-top: 1rem;">다시 시도</button>
      </div>
    `;
    paginationControls.innerHTML = '';
  }
}

// Map library KDC category to CSS gradient class name
function getGradientClass(category) {
  if (!category) return 'gradient-default';
  if (category.includes('문학')) return 'gradient-lit';
  if (category.includes('역사')) return 'gradient-hist';
  if (category.includes('철학')) return 'gradient-phil';
  if (category.includes('과학') || category.includes('기술') || category.includes('수학') || category.includes('의학')) return 'gradient-sci';
  if (category.includes('사회') || category.includes('정치') || category.includes('경제') || category.includes('법학')) return 'gradient-soc';
  if (category.includes('예술') || category.includes('미술') || category.includes('체육') || category.includes('음악')) return 'gradient-art';
  if (category.includes('종교')) return 'gradient-rel';
  return 'gradient-default';
}

// Render dynamic book list row elements
function renderBooksList(books) {
  if (books.length === 0) {
    booksListContainer.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-book-open"></i>
        <p>검색 조건에 맞는 추천 도서가 존재하지 않습니다.</p>
      </div>
    `;
    return;
  }

  let html = '';
  books.forEach(book => {
    const isLibrarian = book.source_type === '사서추천';
    const sourceClass = isLibrarian ? 'badge-source-lib' : 'badge-source-univ';
    
    const author = book.author || '저자 미상';
    const publisher = book.publisher || '출판사 미상';
    const category = book.category || (isLibrarian ? '도서' : '추천도서');

    // Build cover image HTML (scraped image vs premium CSS-based Book Cover)
    const hasImage = book.image_url && book.image_url !== 'failed';
    let imgHtml = '';
    
    if (hasImage) {
      imgHtml = `<img src="${book.image_url}" class="book-cover-img" alt="${book.title}" loading="lazy" onload="this.classList.add('loaded')">`;
    } else {
      // 3D styled CSS cover placeholder using categories gradients
      const gradientClass = getGradientClass(book.category);
      const shortTitle = book.title.length > 25 ? book.title.substring(0, 22) + '...' : book.title;
      imgHtml = `
        <div class="css-book-cover ${gradientClass}">
          <div class="css-book-spine"></div>
          <div class="css-book-title">${shortTitle}</div>
          <div class="css-book-ribbon"></div>
        </div>
      `;
    }

    const isFav = book.is_favorite === 1 || state.favorites.some(f => f.book_id === book.id);
    const isRead = state.readBooks.includes(book.id);
    const favClass = isFav ? 'active' : '';
    const readClass = isRead ? 'active' : '';
    const readCompletedClass = isRead ? 'read-completed' : '';

    html += `
      <div class="book-row ${readCompletedClass}" data-id="${book.id}">
        <div class="book-cover-container">
          <div class="book-cover-fallback"><i class="fa-solid fa-book"></i></div>
          ${imgHtml}
        </div>
        <div class="book-info-col">
          <div class="book-title-row">
            <div class="book-row-title-text-wrap">
              <h3 class="book-row-title" title="${book.title}">${book.title}</h3>
            </div>
            <div class="book-action-buttons-container">
              <!-- Favorite Star Toggle -->
              <button class="book-favorite-btn ${favClass}" data-id="${book.id}" title="즐겨찾기">
                <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i>
              </button>
              <!-- Read Status Toggle -->
              <button class="book-read-btn ${readClass}" data-id="${book.id}" title="읽음 완료">
                <i class="fa-solid fa-book-open"></i>
              </button>
            </div>
          </div>
          <div class="book-meta-details" style="margin-top: 0.25rem;">
            <span>${author}</span>
            <span class="meta-divider"></span>
            <span>${publisher}</span>
            <span class="meta-divider"></span>
            <span>${book.pub_year ? book.pub_year.substring(0, 10) : '발행일 미상'}</span>
            ${book.isbn ? `
              <span class="meta-divider"></span>
              <span class="meta-isbn">ISBN: ${book.isbn}</span>
            ` : ''}
          </div>
        </div>
        <div class="book-badge-col">
          <div class="badge-container">
            <span class="badge ${sourceClass}">${book.source_type}</span>
            <span class="badge badge-subtype">${book.source_subtype}</span>
            ${book.category ? `<span class="badge badge-category">${category}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  });
  
  booksListContainer.innerHTML = html;
  
  // Attach detail click events
  booksListContainer.querySelectorAll('.book-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Ignore click if action button was targeted
      if (e.target.closest('.book-favorite-btn') || e.target.closest('.book-read-btn')) return;
      openBookDetail(row.dataset.id);
    });
  });

  // Star favorite toggle click handler
  booksListContainer.querySelectorAll('.book-favorite-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      await handleToggleFavorite(bookId);
    });
  });

  // Read toggle click handler
  booksListContainer.querySelectorAll('.book-read-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      handleToggleReadBook(bookId);
    });
  });
}

// Page buttons pager rendering with ellipses support
function renderPagination(totalPages, currentPage) {
  if (totalPages <= 1) {
    paginationControls.innerHTML = '';
    return;
  }
  
  let html = '';
  
  // Prev Button
  const prevDisabled = currentPage === 1 ? 'disabled' : '';
  html += `<button class="page-btn ${prevDisabled}" data-page="${currentPage - 1}"><i class="fa-solid fa-chevron-left"></i></button>`;
  
  const range = 1; // adjacent pager size
  
  // First page always visible
  if (currentPage > range + 2) {
    html += `<button class="page-btn" data-page="1">1</button>`;
    html += `<span class="page-ellipsis">...</span>`;
  } else if (currentPage > range + 1) {
    html += `<button class="page-btn" data-page="1">1</button>`;
  }
  
  for (let i = Math.max(1, currentPage - range); i <= Math.min(totalPages, currentPage + range); i++) {
    const active = i === currentPage ? 'active' : '';
    html += `<button class="page-btn ${active}" data-page="${i}">${i}</button>`;
  }
  
  // Last page always visible
  if (currentPage < totalPages - range - 1) {
    html += `<span class="page-ellipsis">...</span>`;
    html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
  } else if (currentPage < totalPages - range) {
    html += `<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`;
  }
  
  // Next Button
  const nextDisabled = currentPage === totalPages ? 'disabled' : '';
  html += `<button class="page-btn ${nextDisabled}" data-page="${currentPage + 1}"><i class="fa-solid fa-chevron-right"></i></button>`;
  
  paginationControls.innerHTML = html;
  
  // Page buttons click event triggers loading
  paginationControls.querySelectorAll('.page-btn:not(.disabled)').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = parseInt(btn.dataset.page);
      fetchBooks();
      document.querySelector('.results-meta').scrollIntoView({ behavior: 'smooth' });
    });
  });
}

// Fetch single book and open in overlay modal
async function openBookDetail(id) {
  bookDetailModal.classList.add('active');
  modalContentArea.innerHTML = '<div class="loading-spinner"></div>';
  
  try {
    const res = await fetch(`/api/books/${id}`);
    if (!res.ok) throw new Error('API search error');
    
    const book = await res.json();
    const isLibrarian = book.source_type === '사서추천';
    const sourceClass = isLibrarian ? 'badge-source-lib' : 'badge-source-univ';
    
    // Check if book cover exists (scraped vs custom premium CSS cover)
    const hasImage = book.image_url && book.image_url !== 'failed';
    let imgHtml = '';
    
    if (hasImage) {
      imgHtml = `<img src="${book.image_url}" class="modal-cover-img" alt="${book.title}">`;
    } else {
      const gradientClass = getGradientClass(book.category);
      const shortTitle = book.title.length > 25 ? book.title.substring(0, 22) + '...' : book.title;
      imgHtml = `
        <div class="css-book-cover ${gradientClass}">
          <div class="css-book-spine"></div>
          <div class="css-book-title">${shortTitle}</div>
          <div class="css-book-ribbon"></div>
        </div>
      `;
    }

    let metaFields = `
      <div class="meta-item">
        <span class="meta-label">출판사</span>
        <span class="meta-val">${book.publisher || '-'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">발행일</span>
        <span class="meta-val">${book.pub_year || '-'}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">ISBN</span>
        <span class="meta-val">${book.isbn || '-'}</span>
      </div>
    `;

    if (isLibrarian) {
      metaFields += `
        <div class="meta-item">
          <span class="meta-label">청구기호</span>
          <span class="meta-val">${book.call_number || '-'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">추천년월</span>
          <span class="meta-val">${book.recommendation_month || '-'}</span>
        </div>
      `;
    } else {
      metaFields += `
        <div class="meta-item">
          <span class="meta-label">정가</span>
          <span class="meta-val">${book.price ? book.price + '원' : '-'}</span>
        </div>
      `;
    }

    let descriptionSection = '';
    
    // 도서 소개 및 줄거리 요약 (알라딘/Yes24 크롤링 데이터)
    const cleanSummary = book.summary ? book.summary.trim() : '';
    if (cleanSummary && cleanSummary !== 'failed' && cleanSummary !== '') {
      descriptionSection += `
        <div class="modal-section">
          <h4><i class="fa-solid fa-book-open"></i> 도서 소개 및 줄거리 요약</h4>
          <div class="modal-description-box" style="background-color: #f8fafc; border-color: var(--border-color); font-size: 0.88rem; line-height: 1.6;">${cleanSummary}</div>
        </div>
      `;
    }

    const isFav = book.is_favorite === 1 || state.favorites.some(f => f.book_id === book.id);
    const isRead = state.readBooks.includes(book.id);
    const favClass = isFav ? 'active' : '';
    const readClass = isRead ? 'active' : '';

    modalContentArea.innerHTML = `
      <div class="modal-detail-layout">
        <div class="modal-cover-box">
          ${imgHtml}
        </div>
        <div class="modal-main-details">
          <div class="modal-badges">
            <span class="badge ${sourceClass}">${book.source_type}</span>
            <span class="badge badge-subtype">${book.source_subtype}</span>
            ${book.category ? `<span class="badge badge-category">${book.category}</span>` : ''}
          </div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; width: 100%;">
            <h2 class="modal-title" style="flex: 1; margin: 0.5rem 0;">${book.title}</h2>
            <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem; flex-shrink: 0;">
              <!-- Star icon in modal -->
              <button class="book-favorite-btn ${favClass} modal-fav-btn" data-id="${book.id}" style="font-size: 1.5rem;" title="즐겨찾기">
                <i class="${isFav ? 'fa-solid' : 'fa-regular'} fa-star"></i>
              </button>
              <!-- Read status in modal -->
              <button class="book-read-btn ${readClass} modal-read-btn" data-id="${book.id}" style="font-size: 1.5rem;" title="읽음 완료">
                <i class="fa-solid fa-book-open"></i>
              </button>
            </div>
          </div>
          <p class="modal-author"><i class="fa-solid fa-pen-nib" style="margin-right: 6px;"></i> ${book.author || '저자 미상'}</p>
        </div>
      </div>

      <div class="modal-metadata-grid">
        ${metaFields}
      </div>

      ${descriptionSection}
    `;

    // Bind events inside Modal details
    const modalFavBtn = modalContentArea.querySelector('.modal-fav-btn');
    const modalReadBtn = modalContentArea.querySelector('.modal-read-btn');
    
    modalFavBtn.addEventListener('click', async () => {
      const bookId = modalFavBtn.dataset.id;
      await handleToggleFavorite(bookId);
      const isFavNow = state.favorites.some(f => f.book_id === parseInt(bookId));
      modalFavBtn.classList.toggle('active', isFavNow);
      modalFavBtn.querySelector('i').className = isFavNow ? 'fa-solid fa-star' : 'fa-regular fa-star';
    });

    modalReadBtn.addEventListener('click', () => {
      const bookId = modalReadBtn.dataset.id;
      handleToggleReadBook(bookId);
      const isReadNow = state.readBooks.includes(parseInt(bookId));
      modalReadBtn.classList.toggle('active', isReadNow);
    });
    
  } catch (error) {
    console.error('Error fetching detail data:', error);
    modalContentArea.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-circle-exclamation"></i>
        <p>상세 도서 정보를 불러올 수 없습니다.</p>
      </div>
    `;
  }
}

// Close detail modal
function closeModal() {
  bookDetailModal.classList.remove('active');
}

// ====================================================
// AUTHENTICATION & FAVORITES MANAGEMENT CLIENT LOGIC
// ====================================================

function showAuthModal() {
  authModal.classList.add('active');
  authErrorMsg.classList.add('hidden');
  loginForm.reset();
  registerForm.reset();
}

function closeAuthModal() {
  authModal.classList.remove('active');
}

function updateAuthUI() {
  if (state.user) {
    drawerUserInfo.innerHTML = `
      <div class="user-logged-in-box">
        <div class="user-welcome-text">
          <i class="fa-solid fa-user-check" style="margin-right: 5px; color: var(--success);"></i>
          <span>${state.user.nickname}</span> 님 서재
        </div>
        <button class="btn-logout" id="btn-logout">로그아웃</button>
      </div>
    `;
    drawerFavoritesContent.classList.remove('hidden');
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
  } else {
    drawerUserInfo.innerHTML = `
      <div class="auth-prompt">
        <p>즐겨찾기 목록을 관리하려면 로그인해 주세요.</p>
        <button class="btn-primary" id="btn-show-login-modal-drawer">로그인 / 회원가입</button>
      </div>
    `;
    drawerFavoritesContent.classList.add('hidden');
    favoritesTreeContainer.innerHTML = '';
  }
}

async function handleLogout() {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
  } catch (e) {
    console.error('Logout error:', e);
  }
  
  state.token = '';
  state.user = null;
  state.favorites = [];
  state.folders = [];
  localStorage.removeItem('auth_token');
  
  updateAuthUI();
  fetchBooks();
}

async function checkAuthOnStartup() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.ok) {
      const data = await res.json();
      state.user = data.user;
      updateAuthUI();
      fetchFavoritesAndFolders();
    } else {
      state.token = '';
      localStorage.removeItem('auth_token');
      updateAuthUI();
    }
  } catch (err) {
    console.error('Startup auth check error:', err);
    state.token = '';
    localStorage.removeItem('auth_token');
    updateAuthUI();
  }
}

async function fetchFavoritesAndFolders() {
  if (!state.user) return;
  try {
    const headers = { 'Authorization': `Bearer ${state.token}` };
    const [foldersRes, favoritesRes] = await Promise.all([
      fetch('/api/favorites/folders', { headers }),
      fetch('/api/favorites', { headers })
    ]);
    
    if (!foldersRes.ok || !favoritesRes.ok) throw new Error('API query error');
    
    state.folders = await foldersRes.json();
    state.favorites = await favoritesRes.json();
    
    renderFavoritesTree();
  } catch (err) {
    console.error('Error fetching favorites data:', err);
    favoritesTreeContainer.innerHTML = '<div class="error-text">서재 목록 로드 실패</div>';
  }
}

function renderFavoritesTree() {
  if (state.folders.length === 0) {
    favoritesTreeContainer.innerHTML = `
      <div class="empty-favorites-notice">
        <i class="fa-solid fa-folder-open"></i>
        <p>생성된 폴더가 없습니다. 새 폴더를 만들어 보세요.</p>
      </div>
    `;
    return;
  }

  let html = '';
  state.folders.forEach(folder => {
    const folderBooks = state.favorites.filter(f => f.category_id === folder.id);
    const isOpen = localStorage.getItem(`folder_open_${folder.id}`) === 'true' ? 'open' : '';
    
    let booksHtml = '';
    if (folderBooks.length === 0) {
      booksHtml = `<div class="empty-favorites-notice" style="padding: 1rem;"><p style="font-size:0.75rem;">폴더가 비어 있습니다.</p></div>`;
    } else {
      folderBooks.forEach(fav => {
        const coverHtml = fav.image_url && fav.image_url !== 'failed'
          ? `<img src="${fav.image_url}" class="tree-book-cover" alt="${fav.title}">`
          : `<div class="tree-book-cover-fallback"><i class="fa-solid fa-book"></i></div>`;

        booksHtml += `
          <div class="tree-book-item" data-id="${fav.book_id}">
            <div class="tree-book-info">
              ${coverHtml}
              <div class="tree-book-details">
                <span class="tree-book-title" title="${fav.title}">${fav.title}</span>
                <span class="tree-book-author">${fav.author || '저자 미상'}</span>
              </div>
            </div>
            <div class="tree-book-actions">
              <button class="btn-book-action move-category" title="폴더 이동" data-id="${fav.book_id}"><i class="fa-solid fa-arrows-spin"></i></button>
              <button class="btn-book-action unfavorite" title="즐겨찾기 해제" data-id="${fav.book_id}"><i class="fa-solid fa-trash-can"></i></button>
            </div>
          </div>
        `;
      });
    }

    html += `
      <div class="tree-folder-group ${isOpen}" id="folder-group-${folder.id}">
        <div class="tree-folder-header" data-id="${folder.id}">
          <div class="tree-folder-title-box">
            <span class="folder-arrow-icon"><i class="fa-solid fa-chevron-right"></i></span>
            <span class="folder-icon"><i class="fa-solid fa-folder"></i></span>
            <span class="folder-name-text">${folder.name}</span>
            <span class="folder-count-badge">${folderBooks.length}</span>
          </div>
          ${folder.name !== '미분류' ? `
            <div class="tree-folder-actions">
              <button class="btn-folder-action edit-folder" title="이름 수정" data-id="${folder.id}"><i class="fa-solid fa-pen-to-square"></i></button>
              <button class="btn-folder-action delete delete-folder" title="삭제" data-id="${folder.id}"><i class="fa-solid fa-folder-minus"></i></button>
            </div>
          ` : ''}
        </div>
        <div class="tree-folder-books">
          ${booksHtml}
        </div>
      </div>
    `;
  });

  favoritesTreeContainer.innerHTML = html;
  setupFavoritesTreeEvents();
}

function setupFavoritesTreeEvents() {
  favoritesTreeContainer.querySelectorAll('.tree-folder-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.tree-folder-actions')) return;
      const folderId = header.dataset.id;
      const groupEl = document.getElementById(`folder-group-${folderId}`);
      groupEl.classList.toggle('open');
      localStorage.setItem(`folder_open_${folderId}`, groupEl.classList.contains('open'));
    });
  });

  favoritesTreeContainer.querySelectorAll('.edit-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.id;
      const folder = state.folders.find(f => f.id === parseInt(folderId));
      if (!folder) return;
      
      const newName = prompt('폴더 이름을 입력하세요:', folder.name);
      if (!newName || !newName.trim() || newName.trim() === folder.name) return;
      
      try {
        const res = await fetch(`/api/favorites/folders/${folderId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ name: newName.trim() })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '폴더 수정 실패');
        }
        fetchFavoritesAndFolders();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  favoritesTreeContainer.querySelectorAll('.delete-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.id;
      if (!confirm('정말 이 폴더를 삭제하시겠습니까? (도서들은 미분류로 이동됩니다)')) return;
      
      try {
        const res = await fetch(`/api/favorites/folders/${folderId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '폴더 삭제 실패');
        }
        fetchFavoritesAndFolders();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  favoritesTreeContainer.querySelectorAll('.tree-book-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tree-book-actions')) return;
      openBookDetail(item.dataset.id);
    });
  });

  favoritesTreeContainer.querySelectorAll('.unfavorite').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      await handleToggleFavorite(bookId, true);
    });
  });

  favoritesTreeContainer.querySelectorAll('.move-category').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      
      const folderOptions = state.folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
      const selectionText = prompt(`이동할 폴더 번호를 입력해 주세요:\n\n${folderOptions}`);
      if (!selectionText) return;
      
      const index = parseInt(selectionText.trim()) - 1;
      if (isNaN(index) || index < 0 || index >= state.folders.length) {
        alert('올바른 폴더 번호를 입력해 주세요.');
        return;
      }
      
      const targetFolder = state.folders[index];
      try {
        const res = await fetch(`/api/favorites/${bookId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ category_id: targetFolder.id })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '폴더 이동 실패');
        }
        fetchFavoritesAndFolders();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

async function handleToggleFavorite(bookId, forceDelete = false) {
  if (!state.user) {
    showAuthModal();
    return;
  }

  const isFav = state.favorites.some(f => f.book_id === parseInt(bookId));
  try {
    if (isFav || forceDelete) {
      const res = await fetch(`/api/favorites/${bookId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '즐겨찾기 삭제 실패');
    } else {
      const res = await fetch('/api/favorites', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({ book_id: parseInt(bookId) })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '즐겨찾기 추가 실패');
    }
    
    await fetchFavoritesAndFolders();
    fetchBooks();
  } catch (err) {
    alert(err.message);
  }
}

function handleToggleReadBook(bookId) {
  const parsedId = parseInt(bookId);
  const index = state.readBooks.indexOf(parsedId);
  if (index > -1) {
    state.readBooks.splice(index, 1);
  } else {
    state.readBooks.push(parsedId);
  }
  localStorage.setItem('read_books', JSON.stringify(state.readBooks));
  fetchBooks();
}
