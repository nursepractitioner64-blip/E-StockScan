const { sheet } = require("../config/google");

exports.createSession = async (req, res) => {

  try {

    const rows = await sheet.getRows();

    const today = new Date();

    const yyyymmdd =
      today.getFullYear() +
      String(today.getMonth() + 1).padStart(2, "0") +
      String(today.getDate()).padStart(2, "0");

    const prefix = `S${yyyymmdd}-`;

    const todayRows = rows.filter(r =>
      (r.SESSION_ID || "").startsWith(prefix)
    );

    let nextNo = 1;

    if (todayRows.length) {

      const maxNo = Math.max(
        ...todayRows.map(r =>
          Number(
            (r.SESSION_ID || "")
              .split("-")[1] || 0
          )
        )
      );

      nextNo = maxNo + 1;
    }

    const session_id =
      prefix +
      String(nextNo).padStart(3, "0");

    return res.json({
      ok: true,
      session_id
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      ok: false,
      error: err.message
    });

  }

};