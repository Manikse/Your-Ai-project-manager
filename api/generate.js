// api/generate.js

// Імпортуємо необхідні бібліотеки
const { GoogleGenAI } = require('@google/genai');
const { createClient } = require('@supabase/supabase-js'); 

// Конфігурація (змінні середовища Vercel)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; 
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FREE_GENERATION_LIMIT = 5;

// Створюємо клієнти
// Використовуємо Service Role Key для безпечної взаємодії з DB на бекенді
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY); 
const ai = new GoogleGenAI(GEMINI_API_KEY);

// Інструкції для AI
const SYSTEM_INSTRUCTION = `You are an expert AI content creator specializing in niche digital products. Generate high-quality, structured content based on user input. Your response MUST be formatted using **Markdown** (Headings: #, ##, Lists: *). DO NOT include any introductory or concluding conversational filler.`;

/**
 * Функція для виклику AI
 */
async function callAI(prompt) {
    // Перевірка, чи ключ доступний
    if (!GEMINI_API_KEY) {
        throw new Error('AI API Key is missing. Check Vercel environment variables.');
    }
    
    // Запит до Gemini
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', 
        contents: [
            { role: "user", parts: [{ text: SYSTEM_INSTRUCTION }] },
            { role: "user", parts: [{ text: prompt }] }
        ],
        config: {
            max_output_tokens: 3000, 
            temperature: 0.5, 
        },
    });

    if (!response.text) {
        throw new Error('AI returned an empty response.');
    }
    
    return response.text.trim();
}


/**
 * Головна функція Vercel Serverless Function
 */
module.exports = async (req, res) => {
    // Обмеження до POST-запитів
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }

    try {
        const { topic, type, tone, sectionsCount, userId } = req.body; 
        
        if (!userId || !topic) {
             return res.status(400).json({ error: 'Missing required parameters (userId or topic).' });
        }

        // --- 1. ПЕРЕВІРКА ЛІМІТІВ (Supabase) ---
        
        let { data: profile, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('generations_used, is_pro')
            .eq('id', userId)
            .single();

        // Обробка, якщо профіль не знайдено (створення нового)
        if (profileError && profileError.code === 'PGRST116') {
             await supabaseAdmin.from('profiles').insert([{ id: userId, generations_used: 0, is_pro: false }]);
             profile = { generations_used: 0, is_pro: false };
        } else if (profileError) {
             console.error("Supabase Profile Error:", profileError);
             return res.status(500).json({ error: 'Error accessing user profile data.' });
        }
        
        // Перевірка ліміту для Free користувачів
        if (!profile.is_pro && profile.generations_used >= FREE_GENERATION_LIMIT) {
            return res.status(403).json({ error: `Generation limit reached. Please upgrade to Pro (${FREE_GENERATION_LIMIT} max).` });
        }

        // --- 2. ЛОГІКА ПОСЛІДОВНОЇ ГЕНЕРАЦІЇ (Gemini API) ---
        
        // A. Генерація Змісту (TOC)
        const tocPrompt = `Generate a detailed Table of Contents (TOC) for a "${type}" about: "${topic}". The content should be written in a "${tone}" tone and MUST have exactly ${sectionsCount} main sections/chapters. Provide the TOC as a Markdown list of titles.`;
        const tableOfContents = await callAI(tocPrompt);
        
        // Розбиваємо TOC на окремі розділи для послідовної генерації
        const sections = tableOfContents.split('\n').filter(line => line.trim().startsWith('*') || line.trim().startsWith('#')).slice(0, sectionsCount);
        
        let finalContent = `# ${topic} - A Comprehensive ${type}\n\n---\n\n`;
        finalContent += `## Table of Contents\n\n${tableOfContents}\n\n---\n\n`;

        // B. Генерація Контенту для Кожного Розділу
        for (let i = 0; i < sections.length; i++) {
            const sectionTitle = sections[i].replace(/^[*-]\s*|^\s*#+\s*/, '').trim();
            const contentPrompt = `Based on the overall topic: "${topic}", write a detailed chapter/section titled "${sectionTitle}". The content MUST be high-quality, actionable, and formatted with Markdown. Maintain a consistent "${tone}" tone.`;

            const sectionContent = await callAI(contentPrompt);
            finalContent += `## ${sectionTitle}\n\n${sectionContent}\n\n`;
        }
        
        // --- 3. ОНОВЛЕННЯ ЛІМІТІВ ---
        if (!profile.is_pro) {
            const { error: updateError } = await supabaseAdmin
                .from('profiles')
                .update({ generations_used: profile.generations_used + 1 })
                .eq('id', userId);
            
            if (updateError) {
                 console.error('Error updating usage count:', updateError);
                 // Незважаючи на помилку оновлення, ми повертаємо контент, але логуємо помилку
            }
        }

        // --- 4. ПОВЕРНЕННЯ РЕЗУЛЬТАТУ ---
        res.status(200).json({ 
            text: finalContent, 
            newUsedCount: profile.generations_used + 1 
        });

    } catch (error) {
        console.error('API Function Critical Error:', error.message);
        res.status(500).json({ error: `Generation failed: ${error.message}.` });
    }
};