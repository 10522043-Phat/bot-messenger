require("dotenv").config();
const express  = require("express");
const axios    = require("axios");
const cron     = require("node-cron");
const mongoose = require("mongoose");
const app      = express();
const { google } = require("googleapis");
const SPREADSHEET_ID_1 = process.env.SPREADSHEET_ID_1;
const SPREADSHEET_ID_2 = process.env.SPREADSHEET_ID_2;
const SHEET1_NAME    = process.env.SHEET1_NAME || "Invoice";
const SHEET2_NAME    = process.env.SHEET2_NAME || "Invoice 2";
app.use(express.json());

// ===== CẤU HÌNH =====
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN || "mytoken123";
const MONGODB_URI       = process.env.MONGODB_URI;
const QR_CODE_URL       = process.env.QR_CODE_URL;
const ADMIN_IDS = [
  "28079494701637950",  // Trần Agness
  "35732182966430161",          // Admin
];

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
  .then(async () => {
    console.log("Kết nối MongoDB thành công");
    const saved = await getSettings("allowedNames");
    if (saved) ALLOWED_NAMES = saved;
  })
  .catch(err => console.error("Lỗi MongoDB:", err));

const userSchema = new mongoose.Schema({
  senderId:        { type: String, required: true, unique: true },
  ten:             { type: String, default: "Chưa xác nhận" },
  xacNhan:         { type: Boolean, default: false },
  choDoiThanhToan:    { type: Boolean, default: false },
  thoiGianThamGia: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

const settingsSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, default: null }
});
const Settings = mongoose.model("Settings", settingsSchema);

async function getSettings(key) {
  const doc = await Settings.findOne({ key });
  return doc ? doc.value : null;
}

async function setSettings(key, value) {
  await Settings.findOneAndUpdate(
    { key },
    { value },
    { upsert: true, returnDocument: 'after' }
  );
}

async function taoSheetsClient() {
  return google.sheets({ version: "v4", auth: process.env.GOOGLE_API_KEY });
}

// Đọc 1 file sheet cụ thể theo spreadsheetId + tên tab
async function docMotSheet(sheets, spreadsheetId, sheetName) {
  try {
    console.log(`>>> spreadsheetId: [${spreadsheetId}]`);
    console.log(`>>> sheetName: [${sheetName}]`);
    console.log(`>>> range: ['${sheetName}'!G:J]`);
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!G:J`,
    });
    return res.data.values || [];
  } catch (err) {
    console.error(`Lỗi đọc sheet "${sheetName}" (${spreadsheetId}):`, err.message);
    return [];
  }
}

// Lọc tên chưa đóng từ 1 mảng rows
function locChuaDong(rows, sheet) {
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[0]) continue;

    const ten = row[0].trim();

    // Bỏ qua hàng tiêu đề
    if (
      i === 0 &&
      (ten.toLowerCase().includes("tên") || ten.toLowerCase().includes("name"))
    ) continue;

    // row[3] = cột J (index 3 trong range G:J)
    const trangThai = (row[3] || "").toString().toUpperCase().trim();

    if (trangThai === "FALSE" || trangThai === "") {
      result.push({ ten, sheet }); // sheet để biết từ file nào
    }
  }
  return result;
}

// Đọc cả 2 file Google Sheet, gộp lại và loại trùng tên
async function layDanhSachChuaDong() {
  const sheets = await taoSheetsClient();

  // Đọc song song cả 2 file cùng lúc
  const [rows1, rows2] = await Promise.all([
    docMotSheet(sheets, SPREADSHEET_ID_1, SHEET1_NAME),
    docMotSheet(sheets, SPREADSHEET_ID_2, SHEET2_NAME),
  ]);

  const ds1 = locChuaDong(rows1, "File 1");
  const ds2 = locChuaDong(rows2, "File 2");

  // Gộp, loại trùng tên (case-insensitive)
  const tatCa = [...ds1];
  for (const item of ds2) {
    const trung = tatCa.some(
      x => x.ten.toLowerCase() === item.ten.toLowerCase()
    );
    if (!trung) tatCa.push(item);
  }

  return tatCa; // [{ ten: "Quyên", sheet: "File 1" }, ...]
}

// Gửi nhắc tới từng người chưa đóng
async function nhacNguoiChuaDong() {
  console.log("🔍 Check 2 Google Sheet để nhắc đóng tiền...");

  const chuaDongList = await layDanhSachChuaDong();

  if (chuaDongList.length === 0) {
    console.log("✅ Mọi người đã đóng tiền hết rồi!");
    await setSettings("lastSheetReminder", new Date().toISOString());
    return { nhac: 0, tongChuaDong: 0 };
  }

  console.log(
    `📋 Chưa đóng (${chuaDongList.length}):`,
    chuaDongList.map(x => `${x.ten} [${x.sheet}]`).join(", ")
  );

  let soNguoiNhac = 0;
  for (const { ten, sheet } of chuaDongList) {
    const escaped = ten.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user    = await User.findOne({
      xacNhan: true,
      ten: { $regex: new RegExp(`^${escaped}$`, "i") },
    });

    if (user) {
  await guiTinNhan(
    user.senderId,
    `Hi ${user.ten}! 👋\n\n` +
    `Mình thấy bạn chưa đóng tiền tháng này nè 😅\n` +
    `Bạn thanh toán sớm giúp mình nhé!\n\n` +
    `YES — để nhận mã QR thanh toán\n` +
    `NO  — để hủy đăng ký`
  );
      await User.updateOne({ senderId: user.senderId }, { choDoiThanhToan: true });
      soNguoiNhac++;
    } else {
      console.log(`⚠️  "${ten}" [${sheet}] chưa có trong bot`);
    }
  }

  console.log(`✅ Đã nhắc ${soNguoiNhac}/${chuaDongList.length} người`);
  await setSettings("lastSheetReminder", new Date().toISOString());
  return { nhac: soNguoiNhac, tongChuaDong: chuaDongList.length };
}

// ===== KIỂM TRA ADMIN =====
function laAdmin(senderId) {
  return ADMIN_IDS.includes(senderId);
}

// ===== LƯU USER MỚI =====
async function luuUserMoi(senderId) {
  try {
    const truoc = await User.findOneAndUpdate(
      { senderId },
      { $setOnInsert: { senderId } },
      { upsert: true, returnDocument: 'before' }
    );
    const laMoi = truoc === null;
    if (laMoi) console.log(`Đã lưu user mới: ${senderId}`);
    return laMoi;
  } catch (err) {
    console.error("Lỗi lưu user:", err.message);
    return false;
  }
}

// ===== CHÀO USER MỚI =====
async function xuLyGetStarted(senderId) {
  await guiTinNhan(
    senderId,
    "Êy bạn có thể điền nickname Facebook của bạn cho mình được không\n\n" +
    "Bạn tìm tên mình trong danh sách dưới đây nhé:"
  );
    await guiAnhDanhSachTen(senderId);
}
 
// ===== LỊCH NHẮC ĐÓNG TIỀN =====
cron.schedule("20 14 6 * *", async () => {
  console.log("Gửi nhắc đóng tiền");
  await setSettings("dangThuTien", true);

  const users = await User.find({ xacNhan: true });
  for (const user of users) {
    await User.updateOne({ senderId: user.senderId }, { choDoiThanhToan: true });

    const ten = user.xacNhan ? user.ten : "bạn";
    await guiTinNhan(user.senderId,
     `Hi ${ten}!\n\n` +
     `Tới hạn đóng tiền tháng này rồi bạn có muốn xài tiếp nữa không?\n\n` +
     `YES — để tiếp tục\n` +
     `NO  — để hủy đăng ký`
);
  }
}, { timezone: "Asia/Ho_Chi_Minh" });

// Tắt kỳ thu tiền vào ngày 10 hàng tháng lúc 8:00 sáng
cron.schedule("0 8 10 * *", async () => {
  await setSettings("dangThuTien", false);
  console.log("Đã đóng kỳ thu tiền tháng này");
}, { timezone: "Asia/Ho_Chi_Minh" });

// ===== CRON NHẮC MỖI 2 NGÀY DỰA TRÊN GOOGLE SHEETS =====
// Chạy lúc 9:00 sáng vào các ngày lẻ (1, 3, 5, 7...),
// kết hợp kiểm tra Settings để đảm bảo đúng 2 ngày/lần
cron.schedule("0 9 */2 * *", async () => {
  // Kiểm tra xem đã đủ 48 tiếng kể từ lần nhắc trước chưa
  const lastRun = await getSettings("lastSheetReminder");
  if (lastRun) {
    const diffHours = (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60);
    if (diffHours < 47) {
      console.log(`⏳ Mới nhắc ${Math.floor(diffHours)}h trước, chưa đủ 2 ngày`);
      return;
    }
  }
  const dangThu = await getSettings("dangThuTien");
  if (!dangThu) {
    console.log("⏸ Kỳ thu tiền đã đóng, bỏ qua.");
    return;
  }

  await nhacNguoiChuaDong();
}, { timezone: "Asia/Ho_Chi_Minh" });

// ===== WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook xác thực thành công");
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
        const laMoi = await luuUserMoi(senderId);
        if (laMoi) await xuLyGetStarted(senderId);
      } else if (event.message?.text) {
        const msg = event.message.text.trim();
        console.log(`Tin nhắn từ ${senderId}: ${msg}`);
        let user = await User.findOne({ senderId });
        if (!user) {
          const laMoi = await luuUserMoi(senderId);
          if (laMoi) await xuLyGetStarted(senderId);
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
async function xuLyTinNhan(senderId, userMessage, user) {

  // ===== LỆNH ADMIN =====
const adminLenh = [
  "xem danh sach", "xem ten", "bat thu tien",
  "tat thu tien", "trang thai",
  "kiem tra sheet", "xem chua dong"
];
  const laLenhAdmin =
    adminLenh.includes(userMessage.toLowerCase()) ||
    userMessage.toLowerCase().startsWith("them:") ||
    userMessage.toLowerCase().startsWith("xoa:");

  if (laLenhAdmin) {
    if (!laAdmin(senderId)) {
      await guiTinNhan(senderId, "Bạn không có quyền dùng lệnh này!");
      return;
    }
  }

  // Lệnh thêm tên
  if (userMessage.toLowerCase().startsWith("them:")) {
    const tenMoi = userMessage.split(":")[1].trim();
    if (!ALLOWED_NAMES.includes(tenMoi)) {
      ALLOWED_NAMES.push(tenMoi);
      ALLOWED_NAMES.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
    await setSettings("allowedNames", ALLOWED_NAMES);
    await guiTinNhan(senderId, `✅ Đã thêm "${tenMoi}"!\nHiện có ${ALLOWED_NAMES.length} tên.`);
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
      ALLOWED_NAMES.sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }));
      await setSettings("allowedNames", ALLOWED_NAMES);
      const xoaUser = await User.findOneAndDelete({
       ten: { $regex: new RegExp(`^${tenXoa}$`, "i") }
    });
    if (xoaUser) {
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}" khỏi danh sách và hệ thống!`);
    } else {
      await guiTinNhan(senderId, `✅ Đã xóa "${tenXoa}" khỏi danh sách!\n⚠️ Người này chưa đăng ký bot.`);
    }
  } else {
    await guiTinNhan(senderId, `❌ Không tìm thấy "${tenXoa}"!`);
  }
  return;
}

  // Lệnh xem tên
  if (userMessage.toLowerCase() === "xem ten") {
    const ds = ALLOWED_NAMES.map((t, i) => `${i+1}. ${t}`).join("\n");
    await guiTinNhan(senderId, `📋 Danh sách tên:\n\n${ds}`);
    return;
  }

  // Lệnh xem danh sách đã xác nhận
  if (userMessage.toLowerCase() === "xem danh sach") {
    const users    = await User.find({ xacNhan: true });
    const danhSach = users.map((u, i) => `${i+1}. ${u.ten}`).join("\n");
    if (users.length === 0) {
      await guiTinNhan(senderId, "📋 Chưa có ai xác nhận.");
    } else {
      await guiTinNhan(senderId,
        `📋 Đã xác nhận:\n\n${danhSach}\n\nTổng: ${users.length} người`
      );
    }
    return;
  }

  // ===== XỬ LÝ YES/NO KHI NHẮC ĐÓNG TIỀN =====
  if (user.choDoiThanhToan) {
    const msg = userMessage.toLowerCase();

      if (msg === "yes" || msg === "có" || msg === "co") {
      // Gửi QR code
      await User.updateOne({ senderId }, { choDoiThanhToan: false });
      await guiTinNhan(senderId,
        `Vậy bạn thanh toán giúp mình nhé` 
      );
      await guiAnhQRCode(senderId);
      await guiTinNhan(senderId,
        `Có gì bạn gửi ảnh thanh toán lên nhóm giúp mình nhé`
      );

     } else if (msg === "no" || msg === "không" || msg === "khong") {
      // Xóa khỏi danh sách
      await User.findOneAndDelete({ senderId });
      const index = ALLOWED_NAMES.findIndex(
       t => t.toLowerCase() === user.ten.toLowerCase()
  );
       if (index > -1) ALLOWED_NAMES.splice(index, 1);
      await setSettings("allowedNames", ALLOWED_NAMES);
      await guiTinNhan(senderId,
        `Vậy bạn out tài khoản giúp mình nhe`
      );

    } else {
      // Không phải yes/no
      await guiTinNhan(senderId,
        `YES — để tiếp tục và nhận QR thanh toán\n` +
        `NO  — để hủy đăng ký`
      );
    }
    return;
  }

 // Lệnh xem danh sách chưa đóng từ Sheet (không nhắc)
  if (userMessage.toLowerCase() === "xem chua dong") {
    const list = await layDanhSachChuaDong();
    if (list.length === 0) {
      await guiTinNhan(senderId, "✅ Mọi người đã đóng tiền hết rồi!");
    } else {
      const ds = list
        .map((x, i) => `${i + 1}. ${x.ten}  [${x.sheet}]`)
        .join("\n");
      await guiTinNhan(
        senderId,
        `📋 Chưa đóng tiền (${list.length} người):\n\n${ds}`
      );
    }
    return;
  }

  // Lệnh check Sheet ngay và nhắc luôn (không chờ cron)
  if (userMessage.toLowerCase() === "kiem tra sheet") {
    await guiTinNhan(senderId, "🔍 Đang check Google Sheets...");
    const { nhac, tongChuaDong } = await nhacNguoiChuaDong();
    await guiTinNhan(
      senderId,
      tongChuaDong === 0
        ? "✅ Mọi người đã đóng tiền hết rồi!"
        : `✅ Đã nhắc ${nhac}/${tongChuaDong} người chưa đóng tiền!`
    );
    return;
  }
  // ============================================

  // Lệnh bật/tắt kỳ thu tiền thủ công
  if (userMessage.toLowerCase() === "bat thu tien") {
    await setSettings("dangThuTien", true);
    await guiTinNhan(senderId, "✅ Đã bật kỳ thu tiền!");
    return;
  }

  if (userMessage.toLowerCase() === "tat thu tien") {
    await setSettings("dangThuTien", false);
    await guiTinNhan(senderId, "✅ Đã tắt kỳ thu tiền!");
    return;
  }

  if (userMessage.toLowerCase() === "trang thai") {
    const dangThuTien = await getSettings("dangThuTien");
    await guiTinNhan(senderId, `📊 Kỳ thu tiền: ${dangThuTien ? "🟢 Đang bật" : "🔴 Đang tắt"}`);
    return;
  }

  // Chưa xác nhận → kiểm tra tên
  if (!user.xacNhan) {
    const tenKhop = ALLOWED_NAMES.find(
      t => t.toLowerCase() === userMessage.toLowerCase()
    );
    if (tenKhop) {
      await User.updateOne({ senderId }, { ten: tenKhop, xacNhan: true });
      await guiTinNhan(senderId, `Xác nhận thành công! Xin chào ${tenKhop}!`);

      const dangThuTien = await getSettings("dangThuTien");
      if (dangThuTien) {
        const chuaDong = await layDanhSachChuaDong();
        const daДong = !chuaDong.some(
          x => x.ten.toLowerCase() === tenKhop.toLowerCase()
        );

      if (daДong) {
        await guiTinNhan(senderId, "Tháng này bạn đã đóng tiền rồi nha! ✅");
      } else {
        await User.updateOne({ senderId }, { choDoiThanhToan: true });
        await guiTinNhan(senderId,
          `Tháng này đang thu tiền rồi bạn có muốn tiếp tục không?\n\n` +
          `YES — để tiếp tục\n` +
          `NO  — để hủy đăng ký`
          );
        }
      } else {
        await guiTinNhan(senderId, "Có vấn đề phát sinh thì bạn nhắn cho mình nha.");
      }
    } else {
      await guiTinNhan(senderId,
        `Tên "${userMessage}" của bạn không có trong danh sách.\n` +
        "Bạn tìm tên mình trong danh sách này nhé:"
      );
    await guiAnhDanhSachTen(senderId);
     }
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
    console.log(`Đã gửi: "${text.substring(0, 50)}"`);
  } catch (err) {
    console.error("Lỗi gửi tin:", err.response?.data || err.message);
  }
}

async function guiAnhQRCode(recipientId) {
  try {
    await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      {
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: "image",
            payload: {
              url: QR_CODE_URL,
              is_reusable: true
            }
          }
        }
      },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
    console.log("Đã gửi QR code!");
  } catch (err) {
    console.error("Lỗi gửi QR:", err.response?.data || err.message);
  }
}

async function guiAnhDanhSachTen(recipientId) {
  const savedNames = await getSettings("allowedNames");
  const danhSach = savedNames || ALLOWED_NAMES;
  const ds = [...danhSach]
    .sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' }))
    .map((t, i) => `${i + 1}. ${t}`)
    .join("\n");
  await guiTinNhan(recipientId, `Danh sách thành viên:\n\n${ds}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server chạy tại port ${PORT}`);
  console.log("⏰ Đã bật lịch nhắc đóng tiền tự động!");
});