import type {
  AttendanceDay,
  EmployeeDetails,
  PayrollSummary,
  SalaryAndLoanConfig,
} from '../types/payroll';
import {
  saveFileToDevice,
  shareSlipToWhatsApp,
  stripDataUrlPrefix,
  type WhatsAppShareResult,
} from './nativeFileHelper';
import { formatCurrency, formatHours } from './salaryMath';

export function buildWhatsAppSlipText(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  summary: PayrollSummary
): string {
  const paymentMode =
    employee.bankAccountEnabled === false
      ? 'Cash'
      : `${employee.bankName || 'Bank'} (${employee.accountNo || '-'})`;
  const totalLeaveHours = summary.totalLeaveHours ?? 0;
  const earnedAllowance = summary.earnedAllowance ?? summary.allowances ?? 0;
  const leaveLine =
    totalLeaveHours > 0
      ? `Sick Leave (L.Hrs): ${formatHours(totalLeaveHours)}h (${(
          totalLeaveHours / 8
        ).toFixed(2)}d) | `
      : '';
  const employmentLabel =
    (summary.employmentType ?? config.employmentType) === 'daily_wages'
      ? 'Daily Wages'
      : 'Regular';
  return [
    `*SALARY SLIP - PAYROLL (${employmentLabel})*`,
    `Employee: ${employee.name || '-'} (${employee.employeeId || '-'})`,
    `Department: ${employee.department || '-'} | Section: ${employee.section || '-'}`,
    `Period: ${config.periodId || '-'}`,
    `W. Hrs: ${formatHours(summary.totalRegularHours)}h | ${leaveLine}OT Hrs: ${formatHours(summary.totalOtHours)}h`,
    `Gross Salary: PKR ${formatCurrency(summary.grossSalary)} | Allw: PKR ${formatCurrency(earnedAllowance)}`,
    `Loan Deduction: PKR ${formatCurrency(summary.loanDeduction)} (Remaining: PKR ${formatCurrency(summary.remainingLoan)})`,
    `*Net Salary: PKR ${formatCurrency(summary.netSalary)}*`,
    `Payment Mode: ${paymentMode}`,
  ].join('\n');
}

function formatNowTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawTruncatedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number
) {
  if (!text) return;
  if (ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  ctx.fillText(trimmed + '…', x, y);
}

export async function buildSalarySlipJpg(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[],
  summary: PayrollSummary
): Promise<{ blob: Blob; dataUrl: string; filename: string }> {
  const width = 1440;
  const height = 1030;
  const margin = 56;
  const contentW = width - margin * 2; // 1488

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable');
  }

  const sans = '"Plus Jakarta Sans", Arial, sans-serif';
  const mono = '"JetBrains Mono", "Courier New", monospace';

  // Crisp white paper background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Subtle outer border for clean gallery framing
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  ctx.fillStyle = '#0F172A';
  ctx.textBaseline = 'alphabetic';

  // Top Header Row
  let y = 78;
  ctx.font = `500 21px ${sans}`;
  ctx.textAlign = 'left';
  ctx.fillText(`User ID:  ${employee.userId || 'nadeem'}`, margin, y + 6);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#334155';
  ctx.font = `500 20px ${sans}`;
  ctx.fillText('Page 1 of 1', width - margin, y);

  ctx.fillStyle = '#020617';
  ctx.font = `700 28px ${mono}`;
  {
    const title = 'SALARY PAYMENT [DETAIL]';
    const charGap = 3.5;
    const widths = Array.from(title).map((ch) => ctx.measureText(ch).width);
    const totalW =
      widths.reduce((acc, w) => acc + w, 0) + charGap * Math.max(0, title.length - 1);
    let cursorX = width / 2 - totalW / 2;
    ctx.textAlign = 'left';
    Array.from(title).forEach((ch, idx) => {
      ctx.fillText(ch, cursorX, y + 4);
      cursorX += widths[idx] + charGap;
    });
    ctx.textAlign = 'center';
  }

  y += 42;
  ctx.font = `700 22px ${sans}`;
  ctx.fillText(
    'Pay Group:    ACCOUNTS/FINANCE',
    width / 2,
    y
  );

  // Department / Section (~46%) + open gap + Period ID / Print Date (~35%)
  y += 66;
  const leftValX = margin + 165;
  const leftLineEnd = margin + Math.round(contentW * 0.46); // ~46% across
  const rightLblX = margin + Math.round(contentW * 0.65); // ~65% across
  const rightValX = rightLblX + 150;

  const drawUnderlinedPair = (
    lbl: string,
    val: string,
    lx: number,
    vx: number,
    lineEnd: number,
    rowY: number,
    valFont: string,
    centerVal = false,
    boldLbl = false
  ) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = boldLbl ? '#020617' : '#1E293B';
    ctx.font = `${boldLbl ? '700' : '500'} 21px ${sans}`;
    ctx.fillText(lbl, lx, rowY);

    ctx.fillStyle = '#020617';
    ctx.font = valFont;
    if (centerVal) {
      ctx.textAlign = 'center';
      ctx.fillText(val, (vx + lineEnd) / 2, rowY);
    } else {
      drawTruncatedText(ctx, val, vx, rowY, lineEnd - vx - 8);
    }

    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(vx, rowY + 9);
    ctx.lineTo(lineEnd, rowY + 9);
    ctx.stroke();
  };

  drawUnderlinedPair(
    'Department:',
    (employee.department || '-').toUpperCase(),
    margin,
    leftValX,
    leftLineEnd,
    y,
    `700 21px ${sans}`
  );
  drawUnderlinedPair(
    'Period ID:',
    config.periodId || '01-15',
    rightLblX,
    rightValX,
    width - margin,
    y,
    `700 21px ${mono}`,
    true
  );

  y += 46;
  drawUnderlinedPair(
    'Section:',
    (employee.section || '-').toUpperCase(),
    margin,
    leftValX,
    leftLineEnd,
    y,
    `700 21px ${sans}`
  );
  drawUnderlinedPair(
    'Print Date:',
    formatNowTimestamp(),
    rightLblX,
    rightValX,
    width - margin,
    y,
    `400 20px ${mono}`,
    true
  );

  // Divider line
  y += 30;
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(margin, y);
  ctx.lineTo(width - margin, y);
  ctx.stroke();

  // Middle Block: Employee Info (~51%) | Hours Table (~29%) | Photo Frame (~14.5%)
  const blockTop = y + 36;
  const empEndX = margin + Math.round(contentW * 0.51); // 759px
  const isCashPayment = employee.bankAccountEnabled === false;
  const employmentLabel =
    (summary.employmentType ?? config.employmentType) === 'daily_wages'
      ? 'Daily Wages'
      : 'Regular';

  ctx.textAlign = 'left';
  ctx.fillStyle = '#020617';
  ctx.font = `700 24px ${sans}`;
  ctx.fillText(isCashPayment ? 'Cash' : 'Transfer To Bank', margin, blockTop);
  ctx.textAlign = 'right';
  ctx.fillText(employmentLabel, empEndX, blockTop);

  let empY = blockTop + 42;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#020617';
  ctx.font = `700 21px ${sans}`;
  ctx.fillText('Emp ID:', margin, empY);
  ctx.fillStyle = '#020617';
  ctx.font = `500 21px ${mono}`;
  ctx.fillText(employee.employeeId || '-', margin + 175, empY);

  // Underlined Regular Pay flush with Regular label
  ctx.textAlign = 'right';
  ctx.fillText(formatCurrency(summary.regularPay), empEndX - 4, empY);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(empEndX - 165, empY + 8);
  ctx.lineTo(empEndX, empY + 8);
  ctx.stroke();

  const drawEmpField = (lbl: string, val: string, lblFont: string, valFont: string) => {
    empY += 38;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#020617';
    ctx.font = lblFont;
    ctx.fillText(lbl, margin, empY);
    ctx.fillStyle = '#020617';
    ctx.font = valFont;
    drawTruncatedText(ctx, val, margin + 175, empY, empEndX - (margin + 175) - 6);
  };

  drawEmpField('Name:', (employee.name || '-').toUpperCase(), `700 21px ${sans}`, `500 21px ${sans}`);
  drawEmpField('Father Name:', (employee.fatherName || '-').toUpperCase(), `700 21px ${sans}`, `500 21px ${sans}`);
  drawEmpField('Designation:', (employee.designation || '-').toUpperCase(), `700 21px ${sans}`, `500 21px ${sans}`);

  // Center Hours Table (~29% of contentW) aligned top & bottom with Employee Info & Photo
  const tblX = empEndX + Math.round(contentW * 0.025);
  const tblW = Math.round(contentW * 0.29); // ~432px
  const cW = [Math.round(tblW * 0.36), Math.round(tblW * 0.32), tblW - Math.round(tblW * 0.36) - Math.round(tblW * 0.32)];
  const tblStartY = blockTop - 18;
  const tblTargetH = empY - tblStartY + 8;
  const rH = Math.round(tblTargetH / 5);
  let tblY = tblStartY;

  const totalLeaveHours = summary.totalLeaveHours ?? 0;
  const earnedAllowance = summary.earnedAllowance ?? summary.allowances ?? 0;

  const tblRows: [string, string, string, boolean][] = [
    ['Detail', 'Hours', 'Days', true],
    ['W. Hrs:', formatHours(summary.totalRegularHours), (summary.totalRegularHours / 8).toFixed(2), false],
    ['L. Hrs:', formatHours(totalLeaveHours), (totalLeaveHours / 8).toFixed(2), false],
    ['OT. Hrs:', formatHours(summary.totalOtHours), (summary.totalOtHours / 8).toFixed(2), false],
    ['Total:', formatHours(summary.totalHours), summary.equivalentDays.toFixed(2), true],
  ];

  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 1.8;
  tblRows.forEach(([c1, c2, c3, isBold], idx) => {
    ctx.strokeRect(tblX, tblY, cW[0], rH);
    ctx.strokeRect(tblX + cW[0], tblY, cW[1], rH);
    ctx.strokeRect(tblX + cW[0] + cW[1], tblY, cW[2], rH);

    ctx.fillStyle = '#020617';
    if (idx === 0) {
      ctx.textAlign = 'center';
      ctx.font = `700 20px ${sans}`;
      ctx.fillText(c1, tblX + cW[0] / 2, tblY + rH * 0.68);
      ctx.fillText(c2, tblX + cW[0] + cW[1] / 2, tblY + rH * 0.68);
      ctx.fillText(c3, tblX + cW[0] + cW[1] + cW[2] / 2, tblY + rH * 0.68);
    } else {
      ctx.textAlign = 'left';
      ctx.font = `${isBold ? '700' : '500'} 20px ${sans}`;
      ctx.fillText(c1, tblX + 12, tblY + rH * 0.68);

      ctx.textAlign = 'right';
      ctx.font = `${isBold ? '700' : '500'} 20px ${mono}`;
      ctx.fillText(c2, tblX + cW[0] + cW[1] - 12, tblY + rH * 0.68);
      ctx.fillText(c3, tblX + tblW - 12, tblY + rH * 0.68);
    }
    tblY += rH;
  });

  // Right Photo Frame (~14.5% of contentW, matching table height)
  const photoW = Math.round(contentW * 0.145);
  const photoH = rH * 5;
  const photoX = width - margin - photoW;
  const photoY = tblStartY;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(photoX, photoY, photoW, photoH);
  ctx.strokeStyle = '#0F172A';
  ctx.lineWidth = 2;
  ctx.strokeRect(photoX, photoY, photoW, photoH);

  const photoImg = await loadImage(employee.photoDataUrl || '');
  if (photoImg) {
    ctx.drawImage(photoImg, photoX + 3, photoY + 3, photoW - 6, photoH - 6);
  } else {
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'center';
    ctx.font = `600 18px ${sans}`;
    ctx.fillText('PHOTO', photoX + photoW / 2, photoY + photoH / 2 + 6);
  }

  // Horizontal Financial Row (Proportional Voucher Spacing: 22% | 14% | 22% | 21% | 21%)
  y = Math.max(empY, tblY, photoY + photoH) + 46;
  const gapFin = 16;
  const usableFin = contentW - gapFin * 4;
  const finWeights = [0.22, 0.14, 0.22, 0.21, 0.21];
  const finSpecs: [string, string, boolean][] = [
    ['Gross Salary:', formatCurrency(summary.grossSalary), true],
    ['Allw.', formatCurrency(earnedAllowance), true],
    ['Ded.Adv:', formatCurrency(summary.advanceDeduction), true],
    ['Ded.Loan:', formatCurrency(summary.loanDeduction), true],
    ['Ded.Oth:', formatCurrency(summary.otherDeduction), true],
  ];

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.6;
  let finCursor = margin;
  finSpecs.forEach(([lbl, val, boldLbl], idx) => {
    const segW = Math.round(usableFin * finWeights[idx]);
    const startX = finCursor;
    const endX = idx === finSpecs.length - 1 ? width - margin : startX + segW;

    ctx.textAlign = 'left';
    ctx.fillStyle = boldLbl ? '#020617' : '#0F172A';
    ctx.font = `${boldLbl ? '700' : '500'} 20px ${sans}`;
    ctx.fillText(lbl, startX, y);
    const lineStart = startX + ctx.measureText(lbl).width + 8;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#020617';
    ctx.font = `500 20px ${mono}`;
    ctx.fillText(val, endX - 6, y);

    ctx.beginPath();
    ctx.moveTo(lineStart, y + 7);
    ctx.lineTo(endX, y + 7);
    ctx.stroke();

    finCursor = endX + gapFin;
  });

  y += 46;

  // Bank Account Row (34% | 2% gap | 21% | 4% gap | 39%)
  if (!isCashPayment) {
    const accEnd = margin + Math.round(contentW * 0.34);
    const brStart = margin + Math.round(contentW * 0.36);
    const brEnd = margin + Math.round(contentW * 0.57);
    const bNameStart = margin + Math.round(contentW * 0.61);

    drawUnderlinedPair(
      'Account No:',
      employee.accountNo || '-',
      margin,
      margin + 145,
      accEnd,
      y,
      `500 21px ${mono}`,
      false,
      true
    );
    drawUnderlinedPair(
      'Branch No,:',
      employee.branchNo || '-',
      brStart,
      brStart + 130,
      brEnd,
      y,
      `500 21px ${mono}`
    );
    drawUnderlinedPair(
      'Branch Name:',
      (employee.bankName || '-').toUpperCase(),
      bNameStart,
      bNameStart + 155,
      width - margin,
      y,
      `500 21px ${sans}`
    );
    y += 42;
  } else {
    y -= 6;
  }

  // Net Salary & Thumb Double Box (~57% total left block) + Signature (~33% right)
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = `500 22px ${sans}`;
  ctx.fillText('Net Salary & Thumb:', margin, y + 52);

  const boxX = margin + 250;
  const totalThumbBoxW = Math.round(contentW * 0.57) - 250; // ~598 -> each ~299 -> wait let's match ref ~598? No, 57% of 1488 is 848, minus 250 is 598 -> slightly narrower 260+260=520 feels cleaner!
  const halfBoxW = Math.min(265, Math.round(totalThumbBoxW / 2));
  ctx.strokeStyle = '#020617';
  ctx.lineWidth = 2.4;
  ctx.strokeRect(boxX, y, halfBoxW, 88);
  ctx.strokeRect(boxX + halfBoxW, y, halfBoxW, 88);

  ctx.textAlign = 'center';
  ctx.font = `700 30px ${mono}`;
  ctx.fillText(formatCurrency(summary.netSalary), boxX + halfBoxW / 2, y + 54);

  const sigX = margin + Math.round(contentW * 0.67);
  ctx.textAlign = 'left';
  ctx.font = `700 21px ${sans}`;
  ctx.fillText('X', sigX, y + 34);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sigX, y + 46);
  ctx.lineTo(width - margin, y + 46);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.font = `700 20px ${sans}`;
  drawTruncatedText(
    ctx,
    (employee.name || 'EMPLOYEE SIGNATURE').toUpperCase(),
    (sigX + width - margin) / 2,
    y + 76,
    width - margin - sigX - 10
  );

  // Bottom 2-Band 16-Slot Attendance Detail Grid (12% label | 8 x 11% days)
  y += 120;
  const labelColW = Math.round(contentW * 0.12); // ~178
  const dayColW = (contentW - labelColW) / 8; // ~163.75
  const hDay = 34;
  const hSub = 30;
  const hTime = 52;
  const bandH = hDay + hSub + hTime; // 116

  const drawBand = (daysSlice: AttendanceDay[], bandY: number) => {
    ctx.strokeStyle = '#0F172A';
    ctx.lineWidth = 1.8;

    // Left merged Attendance Detail cell
    ctx.strokeRect(margin, bandY, labelColW, bandH);
    ctx.fillStyle = '#020617';
    ctx.textAlign = 'center';
    ctx.font = `700 20px ${sans}`;
    ctx.fillText('Attendance', margin + labelColW / 2, bandY + bandH / 2 - 6);
    ctx.fillText('Detail', margin + labelColW / 2, bandY + bandH / 2 + 22);

    for (let i = 0; i < 8; i++) {
      const cx = margin + labelColW + i * dayColW;
      const day = daysSlice[i];

      // Full day column outer border
      ctx.strokeStyle = '#0F172A';
      ctx.lineWidth = 1.8;
      ctx.strokeRect(cx, bandY, dayColW, bandH);

      // Framed inset T. IN / T. OUT sub-boxes
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(cx + 4, bandY + hDay + 2, dayColW / 2 - 6, hSub - 4);
      ctx.strokeRect(cx + dayColW / 2 + 2, bandY + hDay + 2, dayColW / 2 - 6, hSub - 4);

      ctx.fillStyle = '#1E293B';
      ctx.font = `500 14px ${sans}`;
      ctx.fillText('T. IN', cx + dayColW * 0.25, bandY + hDay + 20);
      ctx.fillText('T. OUT', cx + dayColW * 0.75, bandY + hDay + 20);

      if (!day) {
        continue;
      }

      ctx.fillStyle = '#020617';
      ctx.font = `700 20px ${mono}`;
      ctx.fillText(day.dateLabel, cx + dayColW / 2, bandY + 25);

      const isOffLabel =
        (day.dayType === 'sunday' ||
          day.dayType === 'holiday' ||
          day.dayType === 'leave' ||
          day.dayType === 'absent') &&
        (!day.inTime || !day.outTime);

      if (isOffLabel) {
        ctx.font = `700 ${day.dayType === 'leave' ? '18px' : '20px'} ${sans}`;
        const label =
          day.dayType === 'leave'
            ? 'Sick Leave'
            : day.dayType.charAt(0).toUpperCase() + day.dayType.slice(1);
        ctx.fillText(label, cx + dayColW / 2, bandY + hDay + hSub + 36);
      } else {
        if (
          (day.dayType === 'sunday' || day.dayType === 'holiday') &&
          day.inTime &&
          day.outTime
        ) {
          const cellTop = bandY + hDay + hSub;
          const workedOffLabel =
            day.dayType === 'holiday' ? 'Holiday' : 'Sunday';
          ctx.fillStyle = '#334155';
          ctx.textAlign = 'center';
          ctx.font = `700 16px ${sans}`;
          ctx.fillText(workedOffLabel, cx + dayColW / 2, cellTop + 20);
          ctx.fillStyle = '#020617';
          ctx.font = `600 17px ${mono}`;
          ctx.fillText(day.inTime || '--:--', cx + dayColW * 0.25, cellTop + 44);
          ctx.fillText(day.outTime || '--:--', cx + dayColW * 0.75, cellTop + 44);
        } else {
          ctx.fillStyle = '#020617';
          ctx.font = `500 18px ${mono}`;
          ctx.fillText(day.inTime || '--:--', cx + dayColW * 0.25, bandY + hDay + hSub + 36);
          ctx.fillText(day.outTime || '--:--', cx + dayColW * 0.75, bandY + hDay + hSub + 36);
        }
      }
    }
  };

  drawBand(attendance.slice(0, 8), y);
  drawBand(attendance.slice(8, 15), y + bandH);

  const safeEmpId = (employee.employeeId || 'EMP').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePeriod = (config.periodId || '15DAYS').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Salary_Slip_${safeEmpId}_${safePeriod}.jpg`;

  const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to generate JPG image'))),
      'image/jpeg',
      0.95
    );
  });

  return { blob, dataUrl, filename };
}

export async function downloadSalarySlipJpg(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[],
  summary: PayrollSummary
): Promise<{
  filename: string;
  dataUrl: string;
  savedToDevice: boolean;
  location: string;
  viaShareSheet?: boolean;
}> {
  const { blob, dataUrl, filename } = await buildSalarySlipJpg(
    employee,
    config,
    attendance,
    summary
  );

  const saveRes = await saveFileToDevice({
    filename,
    blob,
    base64Data: stripDataUrlPrefix(dataUrl),
  });

  return {
    filename,
    dataUrl,
    savedToDevice: saveRes.savedToDevice,
    location: saveRes.location,
    viaShareSheet: saveRes.viaShareSheet,
  };
}

export async function shareSalarySlipJpg(
  employee: EmployeeDetails,
  config: SalaryAndLoanConfig,
  attendance: AttendanceDay[],
  summary: PayrollSummary
): Promise<{
  filename: string;
  dataUrl: string;
  shared: boolean;
  method: WhatsAppShareResult['method'];
}> {
  const { blob, dataUrl, filename } = await buildSalarySlipJpg(
    employee,
    config,
    attendance,
    summary
  );

  const text = buildWhatsAppSlipText(employee, config, summary);
  const res = await shareSlipToWhatsApp({
    filename,
    blob,
    base64Data: stripDataUrlPrefix(dataUrl),
    mimeType: 'image/jpeg',
    title: `Salary Slip - ${employee.name || employee.employeeId || 'Employee'}`,
    text,
  });

  return {
    filename,
    dataUrl,
    shared: res.shared,
    method: res.method,
  };
}
