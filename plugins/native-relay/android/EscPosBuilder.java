package com.boutididact.print.relay;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.Charset;
import java.text.Normalizer;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/** Generation ESC/POS — meme logique que relayCore.js / print-server escpos.js */
public final class EscPosBuilder {

  private static final Charset LATIN1 = Charset.forName("ISO-8859-1");
  private static final int WIDTH = 32;

  private EscPosBuilder() {}

  public static byte[] build(JSONObject ticket) throws IOException {
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    JSONObject shop = ticket.optJSONObject("shop");

    write(out, new byte[]{0x1B, 0x40});
    write(out, new byte[]{0x1B, 0x74, 19});

    write(out, new byte[]{0x1B, 0x61, 0x01});
    write(out, new byte[]{0x1B, 0x45, 0x01});
    write(out, new byte[]{0x1D, 0x21, 0x11});

    String shopName = shop != null && shop.has("name")
        ? shop.optString("name", "BOUTIDIDACT")
        : "BOUTIDIDACT";
    writeln(out, shopName.toUpperCase(Locale.ROOT));

    write(out, new byte[]{0x1D, 0x21, 0x00});
    write(out, new byte[]{0x1B, 0x45, 0x00});

    if (shop != null) {
      if (shop.has("address") && !shop.optString("address", "").isEmpty()) {
        writeln(out, shop.optString("address"));
      }
      if (shop.has("siret") && !shop.optString("siret", "").isEmpty()) {
        writeln(out, "SIRET : " + shop.optString("siret"));
      }
      if (shop.has("tva") && !shop.optString("tva", "").isEmpty()) {
        writeln(out, "TVA : " + shop.optString("tva"));
      }
    }
    drawLine(out);

    write(out, new byte[]{0x1B, 0x61, 0x00});
    SimpleDateFormat dateFmt = new SimpleDateFormat("dd/MM/yyyy", Locale.FRANCE);
    SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm:ss", Locale.FRANCE);
    Date now = new Date();
    String dateStr = dateFmt.format(now);
    String timeStr = timeFmt.format(now);
    String ticketId = ticket.optString("ticketId", "T-" + System.currentTimeMillis());
    writeln(out, padLeftRight("Ticket : " + ticketId, dateStr));
    if (ticket.has("saleId") && !ticket.optString("saleId", "").isEmpty()) {
      writeln(out, padLeftRight("Vente : #" + ticket.optString("saleId"), timeStr));
    } else {
      writeln(out, padLeftRight("", timeStr));
    }
    drawLine(out);

    int nameW = (int) Math.floor(WIDTH * 0.55);
    int qtyW = (int) Math.floor(WIDTH * 0.15);
    int totalW = WIDTH - nameW - qtyW;
    writeln(out, padEnd("Article", nameW) + padCenter("Qte", qtyW) + padStart("Total", totalW));
    drawLine(out);

    JSONArray items = ticket.optJSONArray("items");
    if (items != null) {
      for (int i = 0; i < items.length(); i++) {
        JSONObject it = items.optJSONObject(i);
        if (it == null) continue;
        String name = it.optString("name", "");
        if (name.length() > nameW - 1) name = name.substring(0, nameW - 1);
        int qty = it.optInt("quantity", 1);
        double price = it.optDouble("price", 0);
        String lineTotal = String.format(Locale.US, "%.2f EUR", price * qty);
        writeln(out, padEnd(name, nameW) + padCenter(String.valueOf(qty), qtyW) + padStart(lineTotal, totalW));
        if (qty > 1) {
          writeln(out, String.format(Locale.US, "   %.2f EUR / unite", price));
        }
      }
    }
    drawLine(out);

    write(out, new byte[]{0x1B, 0x61, 0x02});
    write(out, new byte[]{0x1B, 0x45, 0x01});
    write(out, new byte[]{0x1D, 0x21, 0x11});
    writeln(out, String.format(Locale.US, "TOTAL TTC : %.2f EUR", ticket.optDouble("total", 0)));
    write(out, new byte[]{0x1D, 0x21, 0x00});
    write(out, new byte[]{0x1B, 0x45, 0x00});

    JSONArray taxBreakdown = ticket.optJSONArray("taxBreakdown");
    if (taxBreakdown != null && taxBreakdown.length() > 0) {
      write(out, new byte[]{0x1B, 0x61, 0x00});
      writeln(out, "Detail TVA :");
      for (int i = 0; i < taxBreakdown.length(); i++) {
        JSONObject t = taxBreakdown.optJSONObject(i);
        if (t == null) continue;
        writeln(out, String.format(Locale.US,
            "  TVA %s%%  HT %.2f  TVA %.2f",
            t.optString("rate", "0"),
            t.optDouble("base", 0),
            t.optDouble("tax", 0)));
      }
    }

    write(out, new byte[]{0x1B, 0x61, 0x00});
    writeln(out, "Paiement : " + ticket.optString("payment", "CB"));
    drawLine(out);

    write(out, new byte[]{0x1B, 0x61, 0x01});
    if (shop != null && shop.has("footer") && !shop.optString("footer", "").isEmpty()) {
      writeln(out, shop.optString("footer"));
    }
    writeln(out, padCenter("Ticket non valable comme facture", WIDTH));
    writeln(out, padCenter("Edite le " + dateStr + " a " + timeStr, WIDTH));
    writeln(out, "");
    writeln(out, "");
    writeln(out, "");

    write(out, new byte[]{0x1D, 0x56, 0x41, 0x00});
    return out.toByteArray();
  }

  private static void write(ByteArrayOutputStream out, byte[] bytes) throws IOException {
    out.write(bytes);
  }

  private static void writeln(ByteArrayOutputStream out, String line) throws IOException {
    out.write(stripAccents(line).getBytes(LATIN1));
    out.write('\n');
  }

  private static void drawLine(ByteArrayOutputStream out) throws IOException {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < WIDTH; i++) sb.append('-');
    writeln(out, sb.toString());
  }

  private static String stripAccents(String str) {
    if (str == null) return "";
    return Normalizer.normalize(str, Normalizer.Form.NFD)
        .replaceAll("\\p{M}", "");
  }

  private static String padEnd(String s, int w) {
    if (s.length() >= w) return s.substring(0, w);
    StringBuilder sb = new StringBuilder(s);
    while (sb.length() < w) sb.append(' ');
    return sb.toString();
  }

  private static String padStart(String s, int w) {
    if (s.length() >= w) return s.substring(0, w);
    StringBuilder sb = new StringBuilder();
    while (sb.length() + s.length() < w) sb.append(' ');
    sb.append(s);
    return sb.toString();
  }

  private static String padCenter(String s, int w) {
    if (s.length() >= w) return s.substring(0, w);
    int left = (w - s.length()) / 2;
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < left; i++) sb.append(' ');
    sb.append(s);
    while (sb.length() < w) sb.append(' ');
    return sb.toString();
  }

  private static String padLeftRight(String left, String right) {
    int spaces = Math.max(0, WIDTH - left.length() - right.length());
    StringBuilder sb = new StringBuilder(left);
    for (int i = 0; i < spaces; i++) sb.append(' ');
    sb.append(right);
    return sb.toString();
  }
}
