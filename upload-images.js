// upload-images.js
require("dotenv").config();
const axios = require("axios");
const fs    = require("fs");
const path  = require("path");

const IMGBB_API_KEY = process.env.IMGBB_API_KEY;

async function uploadLenImgBB(tenFile) {
  const filePath   = path.join(__dirname, tenFile);
  const base64Data = fs.readFileSync(filePath, { encoding: "base64" });

  const formData = new URLSearchParams();
  formData.append("key",   IMGBB_API_KEY);
  formData.append("image", base64Data);
  formData.append("name",  path.basename(tenFile, path.extname(tenFile)));

  try {
    const res = await axios.post(
      "https://api.imgbb.com/1/upload",
      formData.toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    const url = res.data.data.url;
    console.log(`✅ ${tenFile} → ${url}`);
    return url;
  } catch (err) {
    console.error(`❌ Lỗi upload ${tenFile}:`, err.response?.data || err.message);
    return null;
  }
}

async function main() {
  console.log("📤 Đang upload ảnh lên ImgBB...\n");

  const qrUrl  = await uploadLenImgBB("QR_code.jpg");
  const dsUrl  = await uploadLenImgBB("danh_sach_ten.jpg");

  console.log("\n📋 Copy 2 dòng này vào .env của bạn:");
  console.log(`QR_CODE_URL=${qrUrl}`);
  console.log(`DANH_SACH_TEN_URL=${dsUrl}`);
}

main();