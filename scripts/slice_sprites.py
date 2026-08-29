#!/usr/bin/env python3
"""스프라이트 시트를 캐릭터별 개별 PNG로 분할합니다."""

import os
import png

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "assets", "characters")

# 그리드 정의 (612x408 시트 기준, 투명 배경)
SHEETS = {
    "front": {
        "file": "정면.png",
        "cells": [
            ("bbiya", "front.png", 67, 102, 240, 300),
            ("oru", "front.png", 349, 102, 509, 300),
        ],
    },
    "run": {
        "file": "달리기.png",
        "groups": [
            ("bbiya", "run", 17, 102, 592, 196, 5),
            ("oru", "run", 17, 246, 592, 378, 5),
        ],
    },
    "happy": {
        "file": "회복.png",
        "groups": [
            ("bbiya", "happy", 25, 84, 521, 216, 3),
            ("oru", "happy", 25, 254, 521, 389, 3),
        ],
    },
    "hit": {
        "file": "충돌.png",
        "groups": [
            ("bbiya", "hit", 15, 76, 594, 191, 5),
            ("oru", "hit", 15, 192, 594, 329, 5),
        ],
    },
}


def load_rgba(path):
    reader = png.Reader(filename=path)
    width, height, data, _ = reader.asRGBA8()
    return width, height, list(data)


def is_body_pixel(r, g, b, a):
    """캐릭터 픽셀만 인식 (파란/회색 라벨 텍스트 제외)."""
    if a < 20:
        return False
    # 파란·청색 라벨 (연한 파랑 포함 — AI 곰, AI 병아리 등)
    if b > r and b > g and b > 70 and r < 170:
        return False
    # 회색 RUN_01 등 하단 라벨
    if 90 < r < 200 and 90 < g < 200 and 90 < b < 200:
        if max(r, g, b) - min(r, g, b) < 35:
            return False
    return r + g + b > 40


def trim_alpha_box(rows, w, x0, y0, x1, y1, pad=8, pad_top=None, body_only=False, min_y_floor=None):
    """투명 영역 제거. body_only=True면 캐릭터 픽셀만 기준."""
    if pad_top is None:
        pad_top = 0 if body_only else pad
    min_x, min_y = x1, y1
    max_x, max_y = x0, y0
    found = False
    check = is_body_pixel if body_only else lambda r, g, b, a: a > 20
    for y in range(y0, y1):
        row = rows[y]
        for x in range(x0, x1):
            r, g, b, a = row[x * 4 : x * 4 + 4]
            if check(r, g, b, a):
                found = True
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                min_y = min(min_y, y)
                max_y = max(max_y, y)
    if not found:
        return x0, y0, x1, y1
    if min_y_floor is not None:
        min_y = max(min_y, min_y_floor)
    return (
        max(0, min_x - pad),
        max(0, min_y - pad_top),
        min(w, max_x + pad + 1),
        max_y + pad + 1,
    )


def is_white_body(r, g, b, a):
    if a < 40:
        return False
    if is_blue_label_pixel(r, g, b, a):
        return False
    return r > 168 and g > 168 and b > 168


def is_blue_label_pixel(r, g, b, a):
    """시트 상단 한글/영문 라벨 (헤어밴드·흰 몸통과 구분)."""
    if a < 25:
        return False
    # AI 헤어밴드 — 진한 순수 파랑
    if r < 80 and b > 180:
        return False
    if b >= max(r, g) + 8 and b > 100 and r < 210:
        return True
    return False


def is_gray_label(r, g, b, a):
    return (
        a > 40
        and 90 < r < 200
        and 90 < g < 200
        and 90 < b < 200
        and max(r, g, b) - min(r, g, b) < 35
    )


def is_yellow_body(r, g, b, a):
    if a < 40:
        return False
    if is_blue_label_pixel(r, g, b, a):
        return False
    return r > 200 and g > 150 and b < 130


def find_body_top(rows, x0, x1, y0, y1, body_check, min_count=45):
    """라벨이 아닌 캐릭터 몸통이 본격적으로 시작하는 줄."""
    for y in range(y0, y1):
        label = sum(
            1
            for x in range(x0, x1)
            if is_blue_label_pixel(*rows[y][x * 4 : x * 4 + 4])
        )
        body = sum(
            1 for x in range(x0, x1) if body_check(*rows[y][x * 4 : x * 4 + 4])
        )
        if body >= min_count and label < 12:
            return y
    return y0


def compute_row_body_top(rows, x0, y0, x1, y1, count, body_check, min_count=45):
    total_w = x1 - x0
    col_w = total_w / count
    tops = []
    for i in range(count):
        cx0 = int(round(x0 + i * col_w))
        cx1 = int(round(x0 + (i + 1) * col_w))
        tops.append(find_body_top(rows, cx0, cx1, y0, y1, body_check, min_count))
    return min(tops) if tops else y0


def is_happy_pixel(r, g, b, a, y, body_top, is_body_fn):
    if a < 20:
        return False
    if is_gray_label(r, g, b, a):
        return False
    if y < body_top and is_blue_label_pixel(r, g, b, a):
        return False
    if y < body_top and not is_body_fn(r, g, b, a):
        return False
    return is_body_fn(r, g, b, a) or (y >= body_top and r + g + b > 40)


def trim_happy_box(rows, w, x0, y0, x1, y1, body_check, row_body_top, pad=6, pad_bottom=10):
    body_top = row_body_top
    search_start = max(y0, body_top - 2)
    is_body_fn = body_check

    min_x, max_x = x1, x0
    max_y = y0
    found = False
    for y in range(search_start, y1):
        row = rows[y]
        for x in range(x0, x1):
            r, g, b, a = row[x * 4 : x * 4 + 4]
            if is_happy_pixel(r, g, b, a, y, body_top, is_body_fn):
                found = True
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if not found:
        return x0, y0, x1, y1
    ty0 = max(y0, body_top - 2)
    return (
        max(0, min_x - pad),
        ty0,
        min(w, max_x + pad + 1),
        min(y1, max_y + pad_bottom),
    )


def find_white_top(rows, x0, x1, y0, y1, threshold=8):
    """캐릭터 흰색 몸체가 시작하는 첫 줄."""
    for y in range(y0, y1):
        white = sum(
            1
            for x in range(x0, x1)
            if is_white_body(*rows[y][x * 4 : x * 4 + 4])
        )
        if white >= threshold:
            return y
    return y0


def is_oru_run_pixel(r, g, b, a, y, white_top):
    """오르 달리기: 라벨만 제외, 헤어밴드·머리·귀 포함."""
    if a < 20:
        return False
    if is_gray_label(r, g, b, a):
        return False
    if y < white_top and is_blue_label_pixel(r, g, b, a):
        return False
    return r + g + b > 40


def find_oru_char_top(rows, x0, x1, y0, y1, white_top):
    """프레임 하나에서 라벨 제외 캐릭터(귀·머리 포함)가 시작하는 y."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = rows[y][x * 4 : x * 4 + 4]
            if is_oru_run_pixel(r, g, b, a, y, white_top):
                return y
    return y0


def compute_oru_row_char_top(rows, x0, y0, x1, y1, count, row_white_top):
    """5프레임 공통 상단 — 귀·머리가 잘리지 않도록 가장 위 프레임 기준."""
    total_w = x1 - x0
    col_w = total_w / count
    tops = []
    for i in range(count):
        cx0 = int(round(x0 + i * col_w))
        cx1 = int(round(x0 + (i + 1) * col_w))
        tops.append(find_oru_char_top(rows, cx0, cx1, y0, y1, row_white_top))
    return min(tops) if tops else y0


def trim_oru_run_box(rows, w, x0, y0, x1, y1, pad=6, pad_top=6, row_white_top=None, row_char_top=None):
    white_top = row_white_top if row_white_top is not None else find_white_top(rows, x0, x1, y0, y1)
    char_top = row_char_top if row_char_top is not None else find_oru_char_top(rows, x0, x1, y0, y1, white_top)

    min_x, max_x = x1, x0
    max_y = y0
    found = False
    for y in range(y0, y1):
        row = rows[y]
        for x in range(x0, x1):
            r, g, b, a = row[x * 4 : x * 4 + 4]
            if is_oru_run_pixel(r, g, b, a, y, white_top):
                found = True
                min_x = min(min_x, x)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
    if not found:
        return x0, y0, x1, y1
    ty0 = max(y0, char_top - pad_top)
    return (
        max(0, min_x - pad),
        ty0,
        min(w, max_x + pad + 1),
        min(y1, max_y + 12),
    )


def compute_oru_row_white_top(rows, x0, y0, x1, y1, count):
    """라벨/몸통 구분용 — 상단 크롭에는 사용하지 않음."""
    return compute_row_body_top(rows, x0, y0, x1, y1, count, is_white_body, min_count=50)


def strip_label_from_rows(out_rows, cw):
    """저장 직전 — 남은 라벨 픽셀을 투명 처리."""
    for y, row in enumerate(out_rows):
        for x in range(cw):
            i = x * 4
            r, g, b, a = row[i], row[i + 1], row[i + 2], row[i + 3]
            if a > 0 and is_blue_label_pixel(r, g, b, a):
                row[i + 3] = 0
    return out_rows


def save_crop(rows, w, x0, y0, x1, y1, out_path, body_only=False, min_y_floor=None, oru_run=False, row_white_top=None, row_char_top=None, happy_mode=None, row_body_top=None):
    if oru_run:
        tx0, ty0, tx1, ty1 = trim_oru_run_box(
            rows, w, x0, y0, x1, y1, row_white_top=row_white_top, row_char_top=row_char_top
        )
    elif happy_mode == "bbiya":
        tx0, ty0, tx1, ty1 = trim_happy_box(
            rows, w, x0, y0, x1, y1, is_yellow_body, row_body_top
        )
    elif happy_mode == "oru":
        tx0, ty0, tx1, ty1 = trim_happy_box(
            rows, w, x0, y0, x1, y1, is_white_body, row_body_top
        )
    else:
        tx0, ty0, tx1, ty1 = trim_alpha_box(
            rows, w, x0, y0, x1, y1, body_only=body_only, min_y_floor=min_y_floor
        )
    cw, ch = tx1 - tx0, ty1 - ty0
    out_rows = []
    for y in range(ty0, ty1):
        src = rows[y]
        row = []
        for x in range(tx0, tx1):
            row.extend(src[x * 4 : x * 4 + 4])
        out_rows.append(row)
    if oru_run or happy_mode:
        strip_label_from_rows(out_rows, cw)
        top_pad = 3
        blank = [0] * (cw * 4)
        out_rows = [list(blank) for _ in range(top_pad)] + out_rows
        ch += top_pad
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "wb") as f:
        png.Writer(width=cw, height=ch, greyscale=False, alpha=True).write(f, out_rows)
    return cw, ch


def slice_row(char, prefix, rows, w, x0, y0, x1, y1, count, body_only=False, min_y_floor=None, oru_run=False, happy_mode=None):
    total_w = x1 - x0
    col_w = total_w / count
    row_white_top = None
    row_char_top = None
    row_body_top = None
    if oru_run:
        row_white_top = compute_oru_row_white_top(rows, x0, y0, x1, y1, count)
        row_char_top = compute_oru_row_char_top(rows, x0, y0, x1, y1, count, row_white_top)
    elif happy_mode == "bbiya":
        row_body_top = compute_row_body_top(rows, x0, y0, x1, y1, count, is_yellow_body, min_count=40)
    elif happy_mode == "oru":
        row_body_top = compute_row_body_top(rows, x0, y0, x1, y1, count, is_white_body, min_count=50)
    saved = []
    for i in range(count):
        cx0 = int(round(x0 + i * col_w))
        cx1 = int(round(x0 + (i + 1) * col_w))
        name = f"{prefix}_{i + 1:02d}.png"
        out = os.path.join(OUT, char, name)
        size = save_crop(
            rows, w, cx0, y0, cx1, y1, out,
            body_only=body_only and not oru_run and not happy_mode,
            min_y_floor=min_y_floor,
            oru_run=oru_run,
            row_white_top=row_white_top,
            row_char_top=row_char_top,
            happy_mode=happy_mode,
            row_body_top=row_body_top,
        )
        saved.append((name, size))
    return saved


def main():
    summary = []
    for sheet_key, cfg in SHEETS.items():
        path = os.path.join(BASE, cfg["file"])
        w, h, rows = load_rgba(path)

        if "cells" in cfg:
            for char, fname, x0, y0, x1, y1 in cfg["cells"]:
                out = os.path.join(OUT, char, fname)
                size = save_crop(rows, w, x0, y0, x1, y1, out)
                summary.append(f"  {char}/{fname}  {size[0]}x{size[1]}")
        else:
            body_only = sheet_key == "run"
            floor_map = {"bbiya": 102}
            for char, prefix, x0, y0, x1, y1, count in cfg["groups"]:
                floor = floor_map.get(char) if body_only else None
                oru_run = body_only and char == "oru"
                happy_mode = sheet_key if sheet_key == "happy" else None
                if happy_mode:
                    happy_mode = char
                saved = slice_row(
                    char, prefix, rows, w, x0, y0, x1, y1, count,
                    body_only=body_only and not oru_run,
                    min_y_floor=floor,
                    oru_run=oru_run,
                    happy_mode=happy_mode if sheet_key == "happy" else None,
                )
                for name, size in saved:
                    summary.append(f"  {char}/{name}  {size[0]}x{size[1]}")

    print("Saved sprites:")
    print("\n".join(summary))


if __name__ == "__main__":
    main()
