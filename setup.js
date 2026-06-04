require("dotenv").config();
const axios = require("axios");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const PAGE_NAME         = process.env.PAGE_NAME || "TranAgness";

async function thietLap() {
  console.log("🔧 Bắt đầu thiết lập bot...\n");
  await taoMessengerProfile();
}

async function taoMessengerProfile() {
  try {
    const res = await axios.post(
      "https://graph.facebook.com/v19.0/me/messenger_profile",
      {
        get_started: { payload: "GET_STARTED" },
        greeting: [
          {
            locale: "default",
            text: "Xin chào! Nhấn Bắt đầu hoặc gửi tin nhắn bất kỳ để đăng ký nhận nhắc đóng tiền tự động 👋",
          },
          {
            locale: "vi_VN",
            text: "Xin chào! Nhấn Bắt đầu hoặc gửi tin nhắn bất kỳ để đăng ký nhận nhắc đóng tiền tự động 👋",
          },
        ],
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );

    console.log("✅ Thiết lập Messenger Profile thành công!", res.data);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📎 Link ghim lên nhóm Facebook:");
    console.log(`   https://m.me/${PAGE_NAME}?ref=welcome`);
    console.log("\n📌 Việc cần làm tiếp theo:");
    console.log("   Vào developers.facebook.com > App > Messenger > API Settings");
    console.log("   > Webhooks > Edit > Tích thêm: messaging_referrals > Save");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  } catch (err) {
    console.error("❌ Lỗi:", err.response?.data || err.message);
  }
}

thietLap();
