const state = {
  search: '',
  searchType: 'all',   // Search lookup type: 'all', 'title', 'author', 'publisher', 'isbn'
  sourceTypes: [],     // Checked sources in sidebar: '사서추천', '대학추천'
  age: '',             // Selected target age group (사서추천 subtype)
  library: '',         // Selected library institution (사서추천 subtype)
  university: '',      // Selected university (대학추천 subtype)
  bestseller: '',      // Selected bestseller category (베스트셀러 subtype)
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
const bestsellerGroup = document.getElementById('filter-group-bestseller');
const bestsellerContainer = document.getElementById('bestseller-options-list');

// Favorites Drawer DOM Elements
const btnToggleFavoritesDrawer = document.getElementById('btn-toggle-favorites-drawer');
const btnCloseDrawer = document.getElementById('btn-close-drawer');
const favoritesDrawer = document.getElementById('favorites-drawer');
const drawerHeaderUser = document.getElementById('drawer-header-user');
const drawerLoginPrompt = document.getElementById('drawer-login-prompt');
const drawerFavoritesContent = document.getElementById('drawer-favorites-content');
const favoritesTreeContainer = document.getElementById('favorites-tree');
const headerRightArea = document.getElementById('header-right-area');

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

  // Close sidebar drawer on backdrop click in mobile/tablet
  document.addEventListener('click', (e) => {
    if (window.innerWidth <= 1024) {
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
      if (!state.sourceTypes.includes('베스트셀러')) state.bestseller = '';
      
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
    state.bestseller = '';
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

  // Show Login Modal — from drawer login prompt
  drawerLoginPrompt.addEventListener('click', (e) => {
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
}

// Reset page completely to default state
function resetAll() {
  state.search = '';
  state.searchType = 'all';
  state.sourceTypes = [];
  state.age = '';
  state.library = '';
  state.university = '';
  state.bestseller = '';
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
  
  if (window.innerWidth <= 1024) {
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
  const showBestseller = state.sourceTypes.length === 0 || state.sourceTypes.includes('베스트셀러');

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

  if (showBestseller) {
    bestsellerGroup.classList.remove('hidden');
  } else {
    bestsellerGroup.classList.add('hidden');
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

  // 3. Render Bestsellers (베스트셀러 분류: 종합, 유아, 어린이, 청소년)
  let bestsellerHtml = '';
  const bestsellerOrder = ['종합', '유아', '어린이', '청소년'];
  const dbBestsellerSubtypes = state.filters.subtypes['베스트셀러'] || [];
  
  bestsellerOrder.forEach(sub => {
    if (dbBestsellerSubtypes.includes(sub)) {
      const checked = state.bestseller === sub ? 'checked' : '';
      bestsellerHtml += createCheckboxRow('bestseller', sub, checked);
    }
  });
  dbBestsellerSubtypes.forEach(sub => {
    if (!bestsellerOrder.includes(sub)) {
      const checked = state.bestseller === sub ? 'checked' : '';
      bestsellerHtml += createCheckboxRow('bestseller', sub, checked);
    }
  });
  bestsellerContainer.innerHTML = bestsellerHtml;
  
  // Setup toggle single-select filters click handlers
  setupFilterClickHandlers(ageContainer, 'age');
  setupFilterClickHandlers(libContainer, 'library');
  setupFilterClickHandlers(univContainer, 'university');
  setupFilterClickHandlers(bestsellerContainer, 'bestseller');
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
        
        // Clear other sub-filters, but preserve parent sources
        if (filterKey === 'age') {
          state.library = '';
          state.university = '';
          state.bestseller = '';
          document.querySelectorAll('input[name="library"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="university"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="bestseller"]').forEach(c => c.checked = false);
          
          if (!state.sourceTypes.includes('사서추천')) {
            state.sourceTypes.push('사서추천');
          }
          sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => {
            if (c.value === '사서추천') c.checked = true;
          });
        } else if (filterKey === 'library') {
          state.age = '';
          state.university = '';
          state.bestseller = '';
          document.querySelectorAll('input[name="age"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="university"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="bestseller"]').forEach(c => c.checked = false);
          
          if (!state.sourceTypes.includes('사서추천')) {
            state.sourceTypes.push('사서추천');
          }
          sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => {
            if (c.value === '사서추천') c.checked = true;
          });
        } else if (filterKey === 'university') {
          state.age = '';
          state.library = '';
          state.bestseller = '';
          document.querySelectorAll('input[name="age"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="library"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="bestseller"]').forEach(c => c.checked = false);
          
          if (!state.sourceTypes.includes('대학추천')) {
            state.sourceTypes.push('대학추천');
          }
          sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => {
            if (c.value === '대학추천') c.checked = true;
          });
        } else if (filterKey === 'bestseller') {
          state.age = '';
          state.library = '';
          state.university = '';
          document.querySelectorAll('input[name="age"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="library"]').forEach(c => c.checked = false);
          document.querySelectorAll('input[name="university"]').forEach(c => c.checked = false);
          
          if (!state.sourceTypes.includes('베스트셀러')) {
            state.sourceTypes.push('베스트셀러');
          }
          sourceOptionsList.querySelectorAll('input[name="sourceType"]').forEach(c => {
            if (c.value === '베스트셀러') c.checked = true;
          });
        }
      }
      
      state.page = 1;
      renderFilters(); // Re-render filters to update visibility based on new sourceTypes
      fetchBooks();
    });
  });
}

// Fetch Recommended Books from API
async function fetchBooks() {
  booksListContainer.innerHTML = '<div class="loading-spinner"></div>';
  
  // Toggle reset button visibility
  if (state.search || state.sourceTypes.length > 0 || state.age || state.library || state.university || state.bestseller || state.category) {
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
    if (state.sourceTypes.length > 0) {
      params.append('sourceType', state.sourceTypes.join(','));
    }
    
    // Choose appropriate subtype parameter
    if (state.age) params.append('subtype', state.age);
    else if (state.library) params.append('subtype', state.library);
    else if (state.university) params.append('subtype', state.university);
    else if (state.bestseller) params.append('subtype', state.bestseller);
    
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
    let sourceClass = 'badge-source-lib';
    if (book.source_type === '대학추천') {
      sourceClass = 'badge-source-univ';
    } else if (book.source_type === '베스트셀러') {
      sourceClass = 'badge-source-best';
    }
    
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
        <div class="book-cover-container">
          <div class="book-cover-fallback"><i class="fa-solid fa-book"></i></div>
          ${imgHtml}
        </div>
        <div class="book-info-col">
          <div class="book-title-row">
            <div class="book-row-title-text-wrap">
              <h3 class="book-row-title" title="${book.title}">${book.title}</h3>
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
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      await handleToggleReadBook(bookId);
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
    let sourceClass = 'badge-source-lib';
    if (book.source_type === '대학추천') {
      sourceClass = 'badge-source-univ';
    } else if (book.source_type === '베스트셀러') {
      sourceClass = 'badge-source-best';
    }
    
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
    
    // 1. 추천 사유 / 도서 소개 (엑셀 입력 데이터)
    const cleanDesc = book.description ? book.description.trim() : '';
    if (cleanDesc && cleanDesc !== '') {
      const descTitle = isLibrarian ? '사서 추천사유' : '도서 소개';
      descriptionSection += `
        <div class="modal-section" style="margin-bottom: 1.25rem;">
          <h4><i class="fa-solid fa-comment-dots"></i> ${descTitle}</h4>
          <div class="modal-description-box" style="background-color: #f8fafc; border-color: var(--border-color); font-size: 0.88rem; line-height: 1.6;">${cleanDesc}</div>
        </div>
      `;
    }
    
    // 2. 줄거리 요약 (알라딘/Yes24 크롤링 데이터)
    const cleanSummary = book.summary ? book.summary.trim() : '';
    if (cleanSummary && cleanSummary !== 'failed' && cleanSummary !== '' && cleanSummary !== cleanDesc) {
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
    });

    modalReadBtn.addEventListener('click', async () => {
      const bookId = modalReadBtn.dataset.id;
      await handleToggleReadBook(bookId);
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
    // 1) drawer-header에 닉네임 표시
    drawerHeaderUser.innerHTML = `
      <span class="drawer-header-nickname">
        <i class="fa-solid fa-user-check"></i> ${state.user.nickname}
      </span>
    `;

    // 2) main-header 우측에 로그아웃 버튼
    headerRightArea.innerHTML = `
      <button class="btn-logout" id="btn-logout">
        <i class="fa-solid fa-right-from-bracket"></i> <span>로그아웃</span>
      </button>
    `;
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // 3) 드로어 콘텐츠 표시, 로그인 프롬프트 숨김
    drawerFavoritesContent.classList.remove('hidden');
    drawerLoginPrompt.classList.add('hidden');
  } else {
    // 1) drawer-header 닉네임 초기화
    drawerHeaderUser.innerHTML = '';

    // 2) main-header 우측 초기화
    headerRightArea.innerHTML = '';

    // 3) 드로어 콘텐츠 숨김, 로그인 프롬프트 표시
    drawerFavoritesContent.classList.add('hidden');
    drawerLoginPrompt.classList.remove('hidden');
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
    
    // Sync state.readBooks from the database favorites
    const readRoot = state.folders.find(f => f.name === '독서 완료' && f.parent_id === null);
    if (readRoot) {
      const readFolderIds = state.folders.filter(f => f.parent_id === readRoot.id).map(f => f.id);
      state.readBooks = state.favorites.filter(f => readFolderIds.includes(f.category_id)).map(f => f.book_id);
    } else {
      state.readBooks = [];
    }
    
    renderFavoritesTree();
  } catch (err) {
    console.error('Error fetching favorites data:', err);
    favoritesTreeContainer.innerHTML = '<div class="error-text">서재 목록 로드 실패</div>';
  }
}

function renderFolderHtml(folder) {
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
        <div class="tree-book-item" data-id="${fav.book_id}" draggable="true">
          <div class="tree-book-info">
            <i class="fa-solid fa-grip-vertical drag-handle" style="color: var(--text-muted); cursor: grab; margin-right: 0.4rem; font-size: 0.85rem;"></i>
            ${coverHtml}
            <div class="tree-book-details">
              <span class="tree-book-title" title="${fav.title}">${fav.title}</span>
              <span class="tree-book-author">${fav.author || '저자 미상'}</span>
            </div>
          </div>
          <div class="tree-book-actions">
            <button class="btn-book-action unfavorite" title="삭제" data-id="${fav.book_id}" data-category-id="${folder.id}"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </div>
      `;
    });
  }

  const favRoot = state.folders.find(f => f.name === '즐겨찾기' && f.parent_id === null);
  const readRoot = state.folders.find(f => f.name === '독서 완료' && f.parent_id === null);
  
  const favSubfolders = favRoot ? state.folders.filter(f => f.parent_id === favRoot.id) : [];
  const minFolderId = favSubfolders.length > 0 ? Math.min(...favSubfolders.map(f => f.id)) : -1;
  const isDefaultFolder = folder.id === minFolderId;
  const isReadSubfolder = readRoot && folder.parent_id === readRoot.id;

  return `
    <div class="tree-folder-group ${isOpen}" id="folder-group-${folder.id}" data-folder-id="${folder.id}">
      <div class="tree-folder-header" data-id="${folder.id}">
        <div class="tree-folder-title-box">
          <span class="folder-arrow-icon"><i class="fa-solid fa-chevron-right"></i></span>
          <span class="folder-icon"><i class="fa-solid fa-folder"></i></span>
          <span class="folder-name-text">${folder.name}</span>
          <span class="folder-count-badge">${folderBooks.length}</span>
        </div>
        <div class="tree-folder-actions">
          <button class="btn-folder-action edit-folder" title="이름 수정" data-id="${folder.id}"><i class="fa-solid fa-pen-to-square"></i></button>
          ${!isDefaultFolder ? `
            <button class="btn-folder-action delete delete-folder" title="삭제" data-id="${folder.id}"><i class="fa-solid fa-folder-minus"></i></button>
          ` : ''}
        </div>
      </div>
      <div class="tree-folder-books">
        ${booksHtml}
      </div>
    </div>
  `;
}

function renderFavoritesTree() {
  const favRoot = state.folders.find(f => f.name === '즐겨찾기' && f.parent_id === null);
  const readRoot = state.folders.find(f => f.name === '독서 완료' && f.parent_id === null);
  
  if (!favRoot || !readRoot) {
    favoritesTreeContainer.innerHTML = '<div class="empty-favorites-notice"><p>서재를 초기화하는 중입니다...</p></div>';
    return;
  }

  let html = '';
  
  // Render Group 1: 즐겨찾기
  const favSubfolders = state.folders.filter(f => f.parent_id === favRoot.id);
  html += `
    <div class="tree-root-section">
      <div class="tree-root-header">
        <i class="fa-solid fa-star" style="color: #fbbf24; margin-right: 6px;"></i>
        <span>즐겨찾기</span>
        <button class="btn-add-folder" data-root="fav" title="새 폴더 추가">
          <i class="fa-solid fa-folder-plus"></i>
        </button>
      </div>
      <div class="tree-root-body">
  `;
  if (favSubfolders.length === 0) {
    html += `<div class="empty-favorites-notice" style="padding: 1rem;"><p style="font-size:0.75rem;">즐겨찾기 폴더가 없습니다.</p></div>`;
  } else {
    favSubfolders.forEach(folder => {
      html += renderFolderHtml(folder);
    });
  }
  html += `
      </div>
    </div>
  `;

  // Render Group 2: 독서 완료
  const readSubfolders = state.folders.filter(f => f.parent_id === readRoot.id)
                                     .sort((a, b) => b.name.localeCompare(a.name)); // 날짜 역순 정렬
  html += `
    <div class="tree-root-section">
      <div class="tree-root-header">
        <i class="fa-solid fa-book-open" style="color: #10b981; margin-right: 6px;"></i>
        <span>독서 완료</span>
        <button class="btn-add-folder" data-root="read" title="새 폴더 추가">
          <i class="fa-solid fa-folder-plus"></i>
        </button>
      </div>
      <div class="tree-root-body">
  `;
  if (readSubfolders.length === 0) {
    html += `<div class="empty-favorites-notice" style="padding: 1rem;"><p style="font-size:0.75rem;">독서 완료된 책이 없습니다.</p></div>`;
  } else {
    readSubfolders.forEach(folder => {
      html += renderFolderHtml(folder);
    });
  }
  html += `
      </div>
    </div>
  `;

  favoritesTreeContainer.innerHTML = html;
  setupFavoritesTreeEvents();
}

function setupFavoritesTreeEvents() {
  // Add folder buttons in each root header
  favoritesTreeContainer.querySelectorAll('.btn-add-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rootType = btn.dataset.root; // 'fav' or 'read'
      const folderName = prompt('새 폴더 이름을 입력하세요:');
      if (!folderName || !folderName.trim()) return;

      // Find parent root id
      const rootName = rootType === 'fav' ? '즐겨찾기' : '독서 완료';
      const rootFolder = state.folders.find(f => f.name === rootName && f.parent_id === null);
      if (!rootFolder) return;

      try {
        const res = await fetch('/api/favorites/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ name: folderName.trim(), parent_id: rootFolder.id })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '폴더 생성 실패');
        fetchFavoritesAndFolders();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // Toggle folder expansion
  favoritesTreeContainer.querySelectorAll('.tree-folder-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.tree-folder-actions')) return;
      const folderId = header.dataset.id;
      const groupEl = document.getElementById(`folder-group-${folderId}`);
      groupEl.classList.toggle('open');
      localStorage.setItem(`folder_open_${folderId}`, groupEl.classList.contains('open'));
    });
  });

  // Edit folder name
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

  // Delete folder
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

  // Book row click in tree drawer
  favoritesTreeContainer.querySelectorAll('.tree-book-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tree-book-actions') || e.target.closest('.drag-handle')) return;
      openBookDetail(item.dataset.id);
    });
  });

  // Unfavorite (delete book from specific folder) button click in tree drawer
  favoritesTreeContainer.querySelectorAll('.unfavorite').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bookId = btn.dataset.id;
      const categoryId = btn.dataset.categoryId;
      
      try {
        const res = await fetch(`/api/favorites/${bookId}?category_id=${categoryId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${state.token}` }
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '삭제 실패');
        }
        await fetchFavoritesAndFolders();
        syncBookUIState(bookId);
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // HTML5 DRAG & DROP BINDINGS
  
  // Drag start for book elements
  favoritesTreeContainer.querySelectorAll('.tree-book-item').forEach(bookEl => {
    bookEl.addEventListener('dragstart', (e) => {
      bookEl.classList.add('dragging');
      e.dataTransfer.setData('text/plain', bookEl.dataset.id);
      
      const sourceFolderEl = bookEl.closest('.tree-folder-group');
      if (sourceFolderEl) {
        e.dataTransfer.setData('source-folder-id', sourceFolderEl.dataset.folderId);
      }
      e.dataTransfer.effectAllowed = 'move';
    });

    bookEl.addEventListener('dragend', () => {
      bookEl.classList.remove('dragging');
    });
  });

  // Drag over and Drop for folder targets
  favoritesTreeContainer.querySelectorAll('.tree-folder-group').forEach(folderEl => {
    folderEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      folderEl.classList.add('drag-over');
    });

    folderEl.addEventListener('dragleave', () => {
      folderEl.classList.remove('drag-over');
    });

    folderEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      folderEl.classList.remove('drag-over');
      
      const bookId = e.dataTransfer.getData('text/plain');
      const sourceFolderId = e.dataTransfer.getData('source-folder-id');
      const targetFolderId = folderEl.dataset.folderId;
      
      if (!bookId || !targetFolderId) return;
      if (sourceFolderId === targetFolderId) return; // Same folder

      try {
        const res = await fetch(`/api/favorites/${bookId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.token}`
          },
          body: JSON.stringify({ 
            category_id: parseInt(targetFolderId),
            source_category_id: sourceFolderId ? parseInt(sourceFolderId) : null
          })
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || '폴더 이동 실패');
        }
        await fetchFavoritesAndFolders();
      } catch (err) {
        alert(err.message);
      }
    });
  });
}

// Sync UI elements of a specific book across lists and modals to match current state
function syncBookUIState(bookId) {
  const parsedId = parseInt(bookId);
  
  // Find if this book is in the Favorites folder root hierarchy
  const favRoot = state.folders.find(f => f.name === '즐겨찾기' && f.parent_id === null);
  const favFolderIds = favRoot ? state.folders.filter(f => f.parent_id === favRoot.id).map(f => f.id) : [];
  
  const isFav = state.favorites.some(f => f.book_id === parsedId && favFolderIds.includes(f.category_id));
  const isRead = state.readBooks.includes(parsedId);
  
  // Update main list favorite buttons
  const favBtns = booksListContainer.querySelectorAll(`.book-favorite-btn[data-id="${bookId}"]`);
  favBtns.forEach(btn => {
    btn.classList.toggle('active', isFav);
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = isFav ? 'fa-solid fa-star' : 'fa-regular fa-star';
    }
  });

  // Update main list read buttons & row containers
  const readBtns = booksListContainer.querySelectorAll(`.book-read-btn[data-id="${bookId}"]`);
  readBtns.forEach(btn => {
    btn.classList.toggle('active', isRead);
  });

  const rows = booksListContainer.querySelectorAll(`.book-row[data-id="${bookId}"]`);
  rows.forEach(row => {
    row.classList.toggle('read-completed', isRead);
  });

  // Update modal buttons if open and matching
  const modalFavBtn = document.querySelector(`.modal-fav-btn[data-id="${bookId}"]`);
  if (modalFavBtn) {
    modalFavBtn.classList.toggle('active', isFav);
    const icon = modalFavBtn.querySelector('i');
    if (icon) {
      icon.className = isFav ? 'fa-solid fa-star' : 'fa-regular fa-star';
    }
  }

  const modalReadBtn = document.querySelector(`.modal-read-btn[data-id="${bookId}"]`);
  if (modalReadBtn) {
    modalReadBtn.classList.toggle('active', isRead);
  }
}

async function handleToggleFavorite(bookId, forceDelete = false) {
  if (!state.user) {
    showAuthModal();
    return;
  }

  const parsedId = parseInt(bookId);
  // Find if this book is in the Favorites folder root hierarchy
  const favRoot = state.folders.find(f => f.name === '즐겨찾기' && f.parent_id === null);
  const favFolderIds = favRoot ? state.folders.filter(f => f.parent_id === favRoot.id).map(f => f.id) : [];
  
  const isFav = state.favorites.some(f => f.book_id === parsedId && favFolderIds.includes(f.category_id));
  const mapping = state.favorites.find(f => f.book_id === parsedId && favFolderIds.includes(f.category_id));
  const categoryToDelete = mapping ? mapping.category_id : null;

  // Optimistic UI update
  const willBeFav = !isFav && !forceDelete;
  
  // Set UI state immediately
  const favBtns = booksListContainer.querySelectorAll(`.book-favorite-btn[data-id="${bookId}"]`);
  favBtns.forEach(btn => {
    btn.classList.toggle('active', willBeFav);
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = willBeFav ? 'fa-solid fa-star' : 'fa-regular fa-star';
    }
  });
  const modalFavBtn = document.querySelector(`.modal-fav-btn[data-id="${bookId}"]`);
  if (modalFavBtn) {
    modalFavBtn.classList.toggle('active', willBeFav);
    const icon = modalFavBtn.querySelector('i');
    if (icon) {
      icon.className = willBeFav ? 'fa-solid fa-star' : 'fa-regular fa-star';
    }
  }

  try {
    if (isFav || forceDelete) {
      // If categoryId is determined, delete from that specific folder
      const url = categoryToDelete ? `/api/favorites/${bookId}?category_id=${categoryToDelete}` : `/api/favorites/${bookId}`;
      const res = await fetch(url, {
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
        body: JSON.stringify({ book_id: parsedId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '즐겨찾기 추가 실패');
    }
    
    await fetchFavoritesAndFolders();
    syncBookUIState(bookId);
  } catch (err) {
    // Revert optimistic update
    syncBookUIState(bookId);
    alert(err.message);
  }
}

async function handleToggleReadBook(bookId) {
  if (!state.user) {
    showAuthModal();
    return;
  }

  const parsedId = parseInt(bookId);
  const isRead = state.readBooks.includes(parsedId);
  const willBeRead = !isRead;

  // Optimistic UI update
  const readBtns = booksListContainer.querySelectorAll(`.book-read-btn[data-id="${bookId}"]`);
  readBtns.forEach(btn => {
    btn.classList.toggle('active', willBeRead);
  });
  const rows = booksListContainer.querySelectorAll(`.book-row[data-id="${bookId}"]`);
  rows.forEach(row => {
    row.classList.toggle('read-completed', willBeRead);
  });
  const modalReadBtn = document.querySelector(`.modal-read-btn[data-id="${bookId}"]`);
  if (modalReadBtn) {
    modalReadBtn.classList.toggle('active', willBeRead);
  }

  try {
    const res = await fetch('/api/favorites/read', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ book_id: parsedId, is_read: willBeRead })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '읽음 상태 변경 실패');
    
    await fetchFavoritesAndFolders();
    syncBookUIState(bookId);
  } catch (err) {
    // Revert optimistic update
    syncBookUIState(bookId);
    alert(err.message);
  }
}
