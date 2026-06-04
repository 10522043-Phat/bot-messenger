const axios = require("axios");

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN; // Thay token vào đây

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
            text: "Bạn nhấn Get Started để nhận thông báo đóng tiền tự động nhé"
          },
          {
            locale: "vi_VN",
            text: "Bạn nhấn Get Started để nhận thông báo đóng tiền tự động nhé"
          }
        ]
      },
      {
        params: { access_token: PAGE_ACCESS_TOKEN }
      }
    );

    console.log("Tạo nút Get Started thành công!", res.data);
  } catch (err) {
    console.error("Lỗi:", err.response?.data || err.message);
  }
}

taoNutGetStarted();