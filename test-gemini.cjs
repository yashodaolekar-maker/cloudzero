const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function run() {
  const models = ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash"];
  for (const m of models) {
    console.log("Trying " + m);
    try {
      await ai.models.generateContent({ model: m, contents: "Hello" });
      console.log("SUCCESS:", m);
    } catch(e) {
      console.log("FAILED:", m, e.message);
    }
  }
}
run();
