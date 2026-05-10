const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();
const { OpenAI, toFile } = require('openai');

const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

class OpenAIService {
  constructor() {
    this.outputDir = path.join(__dirname, '../output');
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  async generateImage(prompt, referenceImages = []) {
    try {
      console.log(`[OpenAIService] Pintando con OpenAI: "${prompt}"`);
      let response;
      
      if (referenceImages && referenceImages.length > 0) {
        console.log(`[OpenAIService] Adjuntando ${referenceImages.length} referencias visuales para OpenAI.`);
        const images = [];
        for (const ref of referenceImages) {
          if (fs.existsSync(ref.absolutePath)) {
            const ext = path.extname(ref.absolutePath).toLowerCase();
            let mimeType = 'image/png';
            if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
            else if (ext === '.webp') mimeType = 'image/webp';

            images.push(await toFile(fs.createReadStream(ref.absolutePath), null, { type: mimeType }));
          }
        }
        
        if (images.length > 0) {
          response = await openaiClient.images.edit({
            model: process.env.OPENAI_IMAGE_EDIT_MODEL || 'gpt-image-2',
            image: images,
            prompt: prompt,
            n: 1,
            size: "1024x1024"
          });
        } else {
          response = await openaiClient.images.generate({
            model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
            prompt: prompt,
            n: 1,
            size: "1024x1024"
          });
        }
      } else {
        response = await openaiClient.images.generate({
          model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
          prompt: prompt,
          n: 1,
          size: "1024x1024"
        });
      }
      
      if (response && response.data && response.data.length > 0 && response.data[0].b64_json) {
        const fileName = `image_${uuidv4()}.png`;
        const filePath = path.join(this.outputDir, fileName);
        fs.writeFileSync(filePath, Buffer.from(response.data[0].b64_json, 'base64'));
        return {
          url: `http://localhost:${process.env.PORT || 3001}/output/${fileName}`,
          path: filePath
        };
      }
      return null;
    } catch (error) {
      console.error("[OpenAIService] Error con OpenAI:", error.message);
      return null;
    }
  }
}

module.exports = new OpenAIService();
