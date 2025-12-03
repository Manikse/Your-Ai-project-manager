// script.js

// --- 1. КОНФІГУРАЦІЯ (ЗАМІНІТЬ СВОЇМИ ЗНАЧЕННЯМИ) ---
const SUPABASE_URL = 'YOUR_SUPABASE_URL'; 
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; 
const STRIPE_UPGRADE_LINK = 'YOUR_STRIPE_CHECKOUT_LINK'; 

const FREE_GENERATION_LIMIT = 5;

// Ініціалізація Supabase
const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// --- 2. ЕЛЕМЕНТИ UI ---
const authModal = document.getElementById('auth-modal');
const appContainer = document.getElementById('app-container');
const authForm = document.getElementById('auth-form');
const authButton = document.getElementById('auth-button');
const toggleRegisterButton = document.getElementById('toggle-register');
const authMessage = document.getElementById('auth-message');
const generationForm = document.getElementById('generation-form');
const generateButton = document.getElementById('generate-button');
const loadingSpinner = document.getElementById('loading-spinner');
const outputDisplay = document.getElementById('output-display');
const actionButtons = document.getElementById('action-buttons');
const generationLimitDisplay = document.getElementById('generation-limit');
const errorMessage = document.getElementById('error-message');


let isRegistering = false; 

// --- 3. ФУНКЦІЇ АВТЕНТИФІКАЦІЇ (SUPABASE) ---

// Перевіряє статус користувача та оновлює UI
async function checkAuthStatus() {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (session) {
        authModal.classList.add('hidden');
        appContainer.classList.remove('hidden');
        await updateLimits(session.user.id);
    } else {
        authModal.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
}

// Оновлює ліміти користувача з таблиці 'profiles'
async function updateLimits(userId) {
    const { data, error } = await supabase
        .from('profiles')
        .select('generations_used, is_pro')
        .eq('id', userId)
        .single();
    
    if (error && error.code !== 'PGRST116') {
        console.error('Error fetching limits:', error);
        generationLimitDisplay.textContent = 'Error loading limits.';
        return;
    }

    const isPro = data?.is_pro || false;
    const used = data?.generations_used || 0;
    const max = isPro ? 'UNLIMITED' : FREE_GENERATION_LIMIT;
    
    generationLimitDisplay.textContent = `Credits: ${used} / ${max} (${isPro ? 'PRO' : 'FREE'})`;

    // Деактивувати кнопку генерації, якщо ліміт вичерпано
    if (!isPro && used >= FREE_GENERATION_LIMIT) {
        generateButton.disabled = true;
        errorMessage.textContent = 'You have reached the limit. Please upgrade to Pro.';
    } else {
        generateButton.disabled = false;
        errorMessage.textContent = '';
    }

    return { isPro, used };
}

// Обробка входу / реєстрації
authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    authMessage.textContent = '';
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;

    let result;
    try {
        if (isRegistering) {
            authButton.textContent = 'Registering...';
            result = await supabase.auth.signUp({ email, password });
        } else {
            authButton.textContent = 'Logging in...';
            result = await supabase.auth.signInWithPassword({ email, password });
        }

        authButton.textContent = isRegistering ? 'Register' : 'Login';

        if (result.error) {
            authMessage.textContent = result.error.message;
        } else if (result.data.user) {
            authMessage.textContent = isRegistering 
                ? 'Registration successful! Check your email for confirmation.'
                : 'Login successful!';
        }
    } catch (e) {
        authMessage.textContent = 'A network error occurred during authentication.';
    }
});

// Перемикання між формами
toggleRegisterButton.addEventListener('click', () => {
    isRegistering = !isRegistering;
    authButton.textContent = isRegistering ? 'Register' : 'Login';
    toggleRegisterButton.textContent = isRegistering ? 'Already have an account? Login' : 'Need an account? Register';
    authMessage.textContent = '';
});

// Обробка виходу
async function handleLogout() {
    await supabase.auth.signOut();
}


// --- 4. ЛОГІКА ГЕНЕРАЦІЇ ---

// Функція для виклику Vercel API Route
async function callGeneratorFunction(data) {
    // Звернення до нашої бекенд-функції: /api/generate
    const response = await fetch('/api/generate', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    return response.json();
}

// Обробка форми генерації
generationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorMessage.textContent = '';
    
    const sessionData = await supabase.auth.getSession();
    const user = sessionData.data.session?.user;
    
    if (!user) {
        errorMessage.textContent = 'Please log in to generate content.';
        return;
    }

    const limits = await updateLimits(user.id);
    if (!limits.isPro && limits.used >= FREE_GENERATION_LIMIT) return; // Повторна перевірка

    // Збір даних для бекенду
    const payload = {
        topic: document.getElementById('niche-topic').value,
        type: document.getElementById('content-type').value,
        tone: document.getElementById('tone').value,
        sectionsCount: parseInt(document.getElementById('sections-count').value),
        userId: user.id // Передаємо ID користувача для бекенду
    };

    loadingSpinner.classList.remove('hidden');
    outputDisplay.innerHTML = '<p class="placeholder">Generating content...</p>';
    actionButtons.classList.add('hidden');
    generateButton.disabled = true;

    try {
        const result = await callGeneratorFunction(payload);

        if (result.error) {
            errorMessage.textContent = result.error;
            outputDisplay.innerHTML = `<p class="error">Error: ${result.error}</p>`;
        } else {
            outputDisplay.innerHTML = result.text.replace(/\n/g, '<br>'); 
            
            // Оновлюємо ліміт UI (бекенд вже оновив DB)
            if (!limits.isPro) {
                await updateLimits(user.id); 
            }

            actionButtons.classList.remove('hidden');
        }
    } catch (e) {
        errorMessage.textContent = 'A critical network error occurred. Check Vercel logs.';
    } finally {
        loadingSpinner.classList.add('hidden');
        generateButton.disabled = false;
    }
});


// --- 5. ЛОГІКА СТРАЙПУ (Перенаправлення) ---

function handleUpgrade() {
    if (STRIPE_UPGRADE_LINK === 'YOUR_STRIPE_CHECKOUT_LINK') {
        alert("Stripe link is not configured yet. Set it up in script.js and in your Stripe dashboard.");
    } else {
        // Перенаправлення на хостовану Stripe сторінку оплати
        window.location.href = STRIPE_UPGRADE_LINK; 
    }
}


// --- 6. ЛОГІКА ЗАВАНТАЖЕННЯ ---

// Завантажити як PDF
document.getElementById('download-pdf-btn').addEventListener('click', () => {
    const element = document.getElementById('output-display');
    html2pdf().from(element).save('AI_Generated_Guide.pdf');
});

// Скопіювати Markdown (використовуємо innerText для отримання чистого тексту)
document.getElementById('copy-markdown-btn').addEventListener('click', () => {
    const markdownContent = outputDisplay.innerText; 
    navigator.clipboard.writeText(markdownContent).then(() => {
        alert('Content copied to clipboard!');
    }).catch(err => {
        console.error('Could not copy text: ', err);
    });
});


// --- 7. ІНІЦІАЛІЗАЦІЯ ---

// Слухач зміни стану автентифікації (Supabase)
supabase.auth.onAuthStateChange((event, session) => {
    // Оновлюємо UI щоразу при вході/виході
    checkAuthStatus(); 
});

// Перевіряємо статус при першому завантаженні
checkAuthStatus();