const axios = require("axios");

const PAGE_ACCESS_TOKEN = "EAAXNCHR5gcQBRh1qOmduGVevVnPF4DEUH5yuxYtpQOryjAhCZCv1kZAJNy9mQni7V1RS91L2ZCSlHZCU5Y9uZAx19S6qjNoY1cY8nJwDxpCbOk8zyyJ1MWRZCMYrKAeZA8TMcjtZAulAU2DZASZBjFT2DEJug7N9d8ZCzqOYei8uRJasHQsAy93tc8ZCfgk2UWPg6UujXT95fX3LPgZDZD"; // Thay token vào đây

async function taoNutGetStarted() {
  try {
    // Tạo nút Get Started
    const res = await axios.post(
      "https://graph.facebook.com/v19.0/me/messenger_profile",
      {
        get_started: { payload: "GET_STARTED" },
        greeting: [
          {
            locale: "default",
            text: "Xin chào! Nhấn Get Started để nhận thông báo đóng tiền tự động 👋"
          },
          {
            locale: "vi_VN",
            text: "Xin chào! Nhấn Bắt đầu để nhận thông báo đóng tiền tự động 👋"
          }
        ]
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN }
      }
    );

    console.log("✅ Tạo nút Get Started thành công!", res.data);
  } catch (err) {
    console.error("❌ Lỗi:", err.response?.data || err.message);
  }
}

taoNutGetStarted();