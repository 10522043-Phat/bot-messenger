require("dotenv").config();
const express  = require("express");
const axios    = require("axios");
const cron     = require("node-cron");
const mongoose = require("mongoose");
const app      = express();
app.use(express.json());

// ===== CẤU HÌNH =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mytoken123";
const MONGODB_URI       = process.env.MONGODB_URI;

let ALLOWED_NAMES = [
  "Quyên", "Trúc Ngân", "Thiên An", "Hao Huynh",
  "Trần Agness", "Bảo Duy", "Ryan Nguyen", "Gia Bảo",
  "Thái Nam", "Nguyễn Phúc", "Đức Thiện", "Trần Yến Nhi",
  "Duy Nguyen", "Vinhh", "Le Bao Khang", "Hùng Anh",
  "Anh Minh", "Đình Hiệu", "Sơn Minh", "Quách Minh Phúc",
  "Nguyen Axiom", "Nguyen Truc", "Hải Dương", "Simon Hua",
  "Khang Tran", "Đăng Khoa", "Xuân Khoa",
  "Nguyên Ngọc Khánh Uyên", "Nguyễn Trường Thịnh",
  "Son Le", "Hà Minh Khải", "Kenneth Reichert", "Trần Bình Minh",
"Công Thành", "Khai Le", "Hương Võ", "Vũ Kha"
];
// ====================


// ===== KẾT NỐI MONGODB =====
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ Kết nối MongoDB thành công!"))
  .catch(err => console.error("❌ Lỗi MongoDB:", err));

const userSchema = new mongoose.Schema({
  senderId:        { type: String, required: true, unique: true },
  ten:             { type: String, default: "Chưa xác nhận" },
  xacNhan:         { type: Boolean, default: false },
  thoiGianThamGia: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);


// ===== LỊCH NHẮC ĐÓNG TIỀN =====
cron.schedule("0 8 1 * *", async () => {
  console.log("⏰ Đến giờ gửi nhắc đóng tiền!");
  const users = await User.find({});
  for (const user of users) {
    const ten = user.xacNhan ? user.ten : "bạn";
    await guiTinNhan(user.senderId,
      `Hi ${ten}!\n\n` +
      `Tới hạn đóng tiền tháng này rồi bạn có muốn xài tiếp nữa không?`
    );
  }
}, { timezone: "Asia/Ho_Chi_Minh" });


// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
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
      const event    = entry.messaging[0];
      const senderId = event.sender.id;

      if (event.postback?.payload === "GET_STARTED") {
        await luuUserMoi(senderId);
        await xuLyGetStarted(senderId);
      } else if (event.message?.text) {
        const msg = event.message.text.trim();
        console.log(`📩 Tin nhắn từ ${senderId}: ${msg}`);
        let user = await User.findOne({ senderId });
        if (!user) {
          await luuUserMoi(senderId);
          await xuLyGetStarted(senderId);
        } else {
          await xuLyTinNhan(senderId, msg, user);
        }
      }
    }
    res.status(200).send("EVENT_RECEIVED");
  } else {
    res.sendStatus(404);
  }
});


// ===== XỬ LÝ TIN NHẮN =====
async function luuUserMoi(senderId) {
  const exists = await User.findOne({ senderId });
  if (!exists) {
    await User.create({ senderId });
    console.log(`💾 Lưu user mới: ${senderId}`);
  }
}

async function xuLyGetStarted(senderId) {
  await guiTinNhan(senderId,
    "Êy bạn có thể điền nickname Facebook của bạn cho mình được không"
  );
}

async function xuLyTinNhan(senderId, userMessage, user) {

  // Lệnh thêm tên
  if (userMessage.toLowerCase().startsWith("them:")) {
    const tenMoi = userMessage.split(":")[1].trim();
    if (!ALLOWED_NAMES.includes(tenMoi)) {
      ALLOWED_NAMES.push(tenMoi);
      await guiTinNhan(senderId, `✅ Đã thêm "${tenMoi}" vào danh sách!\nHiện có ${ALLOWED_NAMES.length} tên.`);
    } else {
      await guiTinNhan(senderId, `⚠️ Tên "${tenMoi}" đã có rồi!`);
    }
    return;
  }

  // Lệnh xóa tên
  if (userMessage.toLowerCase().startsWith("xoa:")) {
    const tenXoa = userMessage.split(":")[1].trim();
    const index  = ALLOWED_NAMES.findIndex(
      t => t.toLowerCase() === tenXoa.toLowerCase()
    );
    if (index > -1) {
      ALLOWED_NAMES.splice(index, 1);
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}" khỏi danh sách!`);
    } else {
      await guiTinNhan(senderId, `❌ Không tìm thấy tên "${tenXoa}"!`);
    }
    return;
  }

  // Lệnh xem tên được phép
  if (userMessage.toLowerCase() === "xem ten") {
    const ds = ALLOWED_NAMES.map((t, i) => `${i+1}. ${t}`).join("\n");
    await guiTinNhan(senderId, `Danh sách tên:\n\n${ds}`);
    return;
  }

  // Lệnh xem ai đã xác nhận
  if (userMessage.toLowerCase() === "xem danh sach") {
    const users   = await User.find({ xacNhan: true });
    const danhSach = users.map((u, i) => `${i+1}. ${u.ten}`).join("\n");
    if (users.length === 0) {
      await guiTinNhan(senderId, "Chưa có ai xác nhận tên.");
    } else {
      await guiTinNhan(senderId,
        `Đã xác nhận:\n\n${danhSach}\n\nTổng: ${users.length} người`
      );
    }
    return;
  }

  // Chưa xác nhận → kiểm tra tên
  if (!user.xacNhan) {
    const tenKhop = ALLOWED_NAMES.find(
      t => t.toLowerCase() === userMessage.toLowerCase()
    );
    if (tenKhop) {
      await User.updateOne({ senderId }, { ten: tenKhop, xacNhan: true });
      await guiTinNhan(senderId, `Cám ơn ${tenKhop} nhá!`);
      await guiTinNhan(senderId, "Bạn cần sự hỗ trợ gì thì nhắn lên đây nhá.");
    } else {
      await guiTinNhan(senderId,
        `Tên "${userMessage}" bị lỗi rồi.\n` +
        "Bạn nhắn lại tên của bạn trên đây được không?"
      );
    }
  } else {
    // Đã xác nhận → chào bình thường
    await guiTinNhan(senderId, `Xin chào ${user.ten}! 👋\nBạn cần hỗ trợ gì không?`);
  }
}


// ===== GỬI TIN NHẮN =====
async function guiTinNhan(recipientId, text) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      { recipient: { id: recipientId }, message: { text } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log(`📤 Đã gửi: "${text.substring(0, 50)}"`);
  } catch (err) {
    console.error("❌ Lỗi gửi tin:", err.response?.data || err.message);
  }
}


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
});