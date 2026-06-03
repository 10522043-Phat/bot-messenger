require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cron = require("node-cron");
const fs = require("fs");
const app = express();
app.use(express.json());

// ===== CẤU HÌNH =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const ALLOWED_NAMES = ["Nguyen Van A", "Tran Thi B"];
const USER_FILE = "users.json";
// ====================


// ===== QUẢN LÝ USER =====
function docDanhSachUser() {
  if (!fs.existsSync(USER_FILE)) return {};
  return JSON.parse(fs.readFileSync(USER_FILE, "utf8"));
}

function luuUser(senderId, ten = "Chưa xác nhận tên") {
  const users = docDanhSachUser();
  // Không ghi đè nếu đã có tên xác nhận rồi
  if (users[senderId] && users[senderId].xacNhan) return;
  users[senderId] = {
    ten: ten,
    xacNhan: false,
    thoiGianThamGia: new Date().toLocaleString("vi-VN")
  };
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
  console.log(`💾 Đã lưu user mới: ${ten} (${senderId})`);
}

function xacNhanUser(senderId, ten) {
  const users = docDanhSachUser();
  users[senderId] = {
    ten: ten,
    xacNhan: true,
    thoiGianThamGia: users[senderId]?.thoiGianThamGia || new Date().toLocaleString("vi-VN")
  };
  fs.writeFileSync(USER_FILE, JSON.stringify(users, null, 2));
  console.log(`✅ Đã xác nhận tên: ${ten} (${senderId})`);
}


// ===== LỊCH NHẮC ĐÓNG TIỀN =====
// Chạy lúc 8:00 sáng ngày 1 mỗi tháng
cron.schedule("0 8 1 * *", async () => {
  console.log("⏰ Đến giờ gửi nhắc đóng tiền!");
  const users = docDanhSachUser();

  for (const [senderId, info] of Object.entries(users)) {
    const ten = info.xacNhan ? info.ten : "bạn";
    await guiTinNhan(
      senderId,
      `💰 Xin chào ${ten}!\n\n` +
      `⚠️ Nhắc nhở: Đã đến hạn đóng tiền tháng này!\n` +
      `📅 Vui lòng đóng trước ngày 05.\n\n` +
      `Cảm ơn bạn! 🙏`
    );
  }
}, { timezone: "Asia/Ho_Chi_Minh" });


// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook xác thực thành công!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  const body = req.body;

  if (body.object === "page") {
    for (const entry of body.entry) {
      const event = entry.messaging[0];
      const senderId = event.sender.id;

      // Khi user nhấn nút "Get Started"
      if (event.postback && event.postback.payload === "GET_STARTED") {
        console.log(`👋 User mới nhấn Get Started: ${senderId}`);
        luuUser(senderId); // Lưu ngay khi tham gia
        await xuLyGetStarted(senderId);
      }

      // Khi user gửi tin nhắn
      else if (event.message && event.message.text) {
        const userMessage = event.message.text.trim();
        console.log(`📩 Tin nhắn từ ${senderId}: ${userMessage}`);

        const users = docDanhSachUser();

        // Nếu user chưa có trong danh sách → lưu và hỏi tên
        if (!users[senderId]) {
          luuUser(senderId);
          await xuLyGetStarted(senderId);
        } else {
          await xuLyTinNhan(senderId, userMessage, users[senderId]);
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});


// ===== XỬ LÝ GET STARTED =====
async function xuLyGetStarted(senderId) {
  await guiTinNhan(senderId,
    "Xin chào! Chào mừng bạn đến với page của chúng tôi!\n\n" +
    "Bạn sẽ nhận được nhắc nhở đóng tiền hàng tháng tự động.\n\n" +
    "Vui lòng nhập họ tên đầy đủ của bạn để xác nhận:\n\n" +
    "Các bạn điền đúng tên ở cột 'Name' từ file Invoice2 đã cung cấp nha!!\n\n" +
    "https://docs.google.com/spreadsheets/d/16qGYp9tNVfZFjy2EkuUCEQb1wAAlRYJx4JU4TxUACJQ/edit?pli=1&gid=0#gid=0"
  );
}


// ===== XỬ LÝ TIN NHẮN =====
async function xuLyTinNhan(senderId, userMessage, userInfo) {
  // Nếu chưa xác nhận tên → kiểm tra tên vừa nhập
  if (!userInfo.xacNhan) {
    const tenKhop = ALLOWED_NAMES.find(
      (ten) => ten.toLowerCase() === userMessage.toLowerCase()
    );

    if (tenKhop) {
      xacNhanUser(senderId, tenKhop);
      await guiTinNhan(senderId, `✅ Xác nhận thành công! Xin chào ${tenKhop}!`);
      await guiTinNhan(senderId,
        "📅 Bạn sẽ nhận nhắc nhở đóng tiền tự động vào ngày 1 hàng tháng.\n" +
        "Cảm ơn bạn đã đăng ký! 🎉"
      );
    } else {
      await guiTinNhan(senderId,
        `❌ Tên "${userMessage}" không có trong danh sách.\n` +
        "Vui lòng nhập lại đúng họ tên đầy đủ của bạn:"
      );
    }
  } else {
    // Đã xác nhận rồi → trả lời bình thường
    await guiTinNhan(senderId,
      `Xin chào ${userInfo.ten}! 👋\n` +
      "Bạn cần hỗ trợ gì không?"
    );
  }
}


// ===== GỬI TIN NHẮN =====
async function guiTinNhan(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message: { text: text },
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`📤 Đã gửi: "${text.substring(0, 50)}..."`);
  } catch (err) {
    console.error("❌ Lỗi gửi tin:", err.response?.data || err.message);
  }
}


app.listen(3000, () => {
  console.log("🚀 Server đang chạy tại http://localhost:3000");
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
});