from __future__ import annotations

import base64
import json
import math
import os
import threading
import time
import uuid
import webbrowser
from pathlib import Path

import cv2
import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from waitress import serve


BASE_DIR = Path(__file__).resolve().parent
UI_DIR = BASE_DIR / "local-ui"
DATA_DIR = BASE_DIR / "local-data"
DATA_DIR.mkdir(exist_ok=True)
DEFAULT_VIDEO = os.environ.get("KPL_DEFAULT_VIDEO", "")
VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}

app = Flask(__name__, static_folder=None)
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()


def json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def video_info(video_path: str):
    path = Path(video_path)
    if not path.is_file():
        raise ValueError(f"找不到视频：{video_path}")
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise ValueError("视频无法解码，请确认文件是有效的 MP4")
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()
    if not fps or not frames:
        raise ValueError("无法读取视频时长")
    return {
        "path": str(path),
        "name": path.name,
        "fps": fps,
        "frames": frames,
        "width": width,
        "height": height,
        "duration": frames / fps,
        "size": path.stat().st_size,
    }


def default_crop(info: dict):
    width, height = info["width"], info["height"]
    if height > width * 1.5:
        return {
            "x": 0,
            "y": round(height * 0.179),
            "w": width,
            "h": min(width, height - round(height * 0.179)),
        }
    side = min(width, height)
    return {"x": 0, "y": 0, "w": side, "h": side}


def read_frame(video_path: str, second: float):
    cap = cv2.VideoCapture(video_path)
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0, second) * 1000)
    ok, frame = cap.read()
    cap.release()
    if not ok:
        raise ValueError(f"无法读取视频 {second:.1f} 秒处的画面")
    return frame


def crop_frame(frame: np.ndarray, crop: dict):
    x = max(0, int(crop["x"]))
    y = max(0, int(crop["y"]))
    w = max(1, int(crop["w"]))
    h = max(1, int(crop["h"]))
    return frame[y : y + h, x : x + w].copy()


def image_data_url(image: np.ndarray, quality: int = 88):
    ok, encoded = cv2.imencode(
        ".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    )
    if not ok:
        raise ValueError("预览图编码失败")
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode("ascii")


def detect_markers(map_image: np.ndarray):
    side = min(map_image.shape[:2])
    scale = 1080 / side
    working = (
        cv2.resize(map_image, (1080, 1080))
        if map_image.shape[:2] != (1080, 1080)
        else map_image.copy()
    )
    hsv = cv2.cvtColor(working, cv2.COLOR_BGR2HSV)
    gray = cv2.GaussianBlur(
        cv2.cvtColor(working, cv2.COLOR_BGR2GRAY), (7, 7), 1.4
    )
    hue, saturation, value = cv2.split(hsv)
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        1.2,
        38,
        param1=90,
        param2=21,
        minRadius=25,
        maxRadius=60,
    )

    yy, xx = np.ogrid[:1080, :1080]
    candidates = []
    circle_rows = (
        np.round(circles[0]).astype(int) if circles is not None else []
    )
    for cx, cy, radius in circle_rows:
        distance = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        blue_score = 0.0
        red_score = 0.0
        for ring_radius in np.linspace(
            max(28, radius * 0.85), min(72, radius * 1.65), 8
        ):
            ring = (distance > ring_radius - 5) & (distance < ring_radius + 5)
            total = max(1, int(ring.sum()))
            blue_score = max(
                blue_score,
                float(
                    np.sum(
                        ring
                        & (hue > 82)
                        & (hue < 106)
                        & (saturation > 110)
                        & (value > 75)
                    )
                    / total
                ),
            )
            red_score = max(
                red_score,
                float(
                    np.sum(
                        ring
                        & (((hue < 12) | (hue > 168)))
                        & (saturation > 120)
                        & (value > 75)
                    )
                    / total
                ),
            )
        inner = distance < max(20, radius * 0.7)
        texture = float(gray[inner].std()) if inner.any() else 0
        team = "blue" if blue_score > red_score else "red"
        color_score = max(blue_score, red_score)
        if color_score < 0.15 or texture < 28:
            continue
        confidence = color_score + min(0.45, texture / 140)
        candidates.append(
            {
                "team": team,
                "x": round(cx / scale, 1),
                "y": round(cy / scale, 1),
                "r": round(max(40, radius / scale), 1),
                "confidence": confidence,
            }
        )

    # The red replay marker is a thick, mostly closed contour. Detecting that
    # contour gives a substantially more reliable centre than Hough alone,
    # especially when two heroes overlap or a portrait edge looks like a
    # second circle.
    red_mask = cv2.bitwise_or(
        cv2.inRange(hsv, (0, 110, 60), (15, 255, 255)),
        cv2.inRange(hsv, (165, 110, 60), (179, 255, 255)),
    )
    red_mask = cv2.morphologyEx(
        red_mask,
        cv2.MORPH_CLOSE,
        np.ones((7, 7), dtype=np.uint8),
    )
    contours, _ = cv2.findContours(
        red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    for contour in contours:
        area = float(cv2.contourArea(contour))
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        if radius <= 0:
            continue
        extent = area / (math.pi * radius * radius)
        if not (45 <= radius <= 72 and area >= 2000 and extent >= 0.55):
            continue
        inner = (xx - cx) ** 2 + (yy - cy) ** 2 < (radius * 0.55) ** 2
        texture = float(gray[inner].std()) if inner.any() else 0
        if texture < 24:
            continue
        candidates.append(
            {
                "team": "red",
                "x": round(cx / scale, 1),
                "y": round(cy / scale, 1),
                "r": round(max(40, radius / scale), 1),
                "confidence": 1.45 + min(0.25, extent * 0.25),
            }
        )

    picked = []
    for team in ("blue", "red"):
        team_candidates = sorted(
            (item for item in candidates if item["team"] == team),
            key=lambda item: item["confidence"],
            reverse=True,
        )
        team_picks = []
        for item in team_candidates:
            if all(
                (item["x"] - other["x"]) ** 2 + (item["y"] - other["y"]) ** 2
                > 28**2
                for other in team_picks
            ):
                team_picks.append(item)
            if len(team_picks) == 5:
                break
        for index, item in enumerate(team_picks):
            item["id"] = f"{team}-{index + 1}"
            item["confidence"] = round(min(0.99, item["confidence"]), 2)
            picked.append(item)
    return picked


def safe_patch(image: np.ndarray, x: float, y: float, half: int):
    cx, cy = int(round(x)), int(round(y))
    padded = cv2.copyMakeBorder(
        image, half, half, half, half, cv2.BORDER_REFLECT_101
    )
    cx += half
    cy += half
    return padded[cy - half : cy + half, cx - half : cx + half].copy()


def match_track(
    frame: np.ndarray,
    template: np.ndarray,
    previous_x: float,
    previous_y: float,
    search_radius: int = 155,
):
    half_h, half_w = template.shape[0] // 2, template.shape[1] // 2
    x0 = max(0, int(previous_x - search_radius - half_w))
    y0 = max(0, int(previous_y - search_radius - half_h))
    x1 = min(frame.shape[1], int(previous_x + search_radius + half_w))
    y1 = min(frame.shape[0], int(previous_y + search_radius + half_h))
    search = frame[y0:y1, x0:x1]
    if search.shape[0] < template.shape[0] or search.shape[1] < template.shape[1]:
        return previous_x, previous_y, 0.0
    result = cv2.matchTemplate(search, template, cv2.TM_CCOEFF_NORMED)
    _, score, _, location = cv2.minMaxLoc(result)
    next_x = x0 + location[0] + half_w
    next_y = y0 + location[1] + half_h
    if score < 0.30:
        return previous_x, previous_y, max(0.0, float(score))
    return float(next_x), float(next_y), float(score)


def tracking_candidates(map_image: np.ndarray):
    """Detect hero rings on the current frame.

    This intentionally returns more than five candidates per team. Motion and
    appearance matching in the tracker performs the final one-to-one selection.
    """
    target_side = 540
    scale_x = map_image.shape[1] / target_side
    scale_y = map_image.shape[0] / target_side
    small = cv2.resize(map_image, (target_side, target_side))
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    gray = cv2.GaussianBlur(
        cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (5, 5), 1.0
    )
    hue, saturation, value = cv2.split(hsv)
    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        1.15,
        16,
        param1=75,
        param2=17,
        minRadius=12,
        maxRadius=31,
    )

    yy, xx = np.ogrid[:target_side, :target_side]
    found = []
    circle_rows = (
        np.round(circles[0]).astype(int) if circles is not None else []
    )
    for cx, cy, radius in circle_rows:
        distance = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        blue_score = 0.0
        red_score = 0.0
        for ring_radius in np.linspace(
            max(14, radius * 0.8), min(36, radius * 1.75), 7
        ):
            ring = (distance > ring_radius - 2.8) & (
                distance < ring_radius + 2.8
            )
            total = max(1, int(ring.sum()))
            blue_score = max(
                blue_score,
                float(
                    np.sum(
                        ring
                        & (hue > 80)
                        & (hue < 108)
                        & (saturation > 95)
                        & (value > 65)
                    )
                    / total
                ),
            )
            red_score = max(
                red_score,
                float(
                    np.sum(
                        ring
                        & ((hue < 14) | (hue > 166))
                        & (saturation > 105)
                        & (value > 65)
                    )
                    / total
                ),
            )
        inner = distance < max(10, radius * 0.72)
        texture = float(gray[inner].std()) if inner.any() else 0
        color_score = max(blue_score, red_score)
        full_radius = radius * (scale_x + scale_y) / 2
        if (
            color_score < 0.13
            or texture < 25
            or full_radius < 30
            or full_radius > 58
        ):
            continue
        x = float(cx * scale_x)
        y = float(cy * scale_y)
        patch_half = max(20, round(map_image.shape[1] * 0.028))
        found.append(
            {
                "team": "blue" if blue_score > red_score else "red",
                "x": x,
                "y": y,
                "radius": full_radius,
                "score": color_score,
                "texture": texture,
                "patch": safe_patch(map_image, x, y, patch_half),
            }
        )

    red_mask = cv2.bitwise_or(
        cv2.inRange(hsv, (0, 110, 60), (15, 255, 255)),
        cv2.inRange(hsv, (165, 110, 60), (179, 255, 255)),
    )
    red_mask = cv2.morphologyEx(
        red_mask,
        cv2.MORPH_CLOSE,
        np.ones((5, 5), dtype=np.uint8),
    )
    contours, _ = cv2.findContours(
        red_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    for contour in contours:
        area = float(cv2.contourArea(contour))
        (cx, cy), radius = cv2.minEnclosingCircle(contour)
        if radius <= 0:
            continue
        extent = area / (math.pi * radius * radius)
        if not (
            22.5 <= radius <= 36
            and area >= 500
            and extent >= 0.55
        ):
            continue
        inner = (xx - cx) ** 2 + (yy - cy) ** 2 < (radius * 0.55) ** 2
        texture = float(gray[inner].std()) if inner.any() else 0
        if texture < 24:
            continue
        x = float(cx * scale_x)
        y = float(cy * scale_y)
        patch_half = max(20, round(map_image.shape[1] * 0.028))
        found.append(
            {
                "team": "red",
                "x": x,
                "y": y,
                "radius": radius * (scale_x + scale_y) / 2,
                "score": min(0.99, 0.7 + extent * 0.3),
                "texture": texture,
                "patch": safe_patch(map_image, x, y, patch_half),
            }
        )

    picked = []
    for team in ("blue", "red"):
        team_items = sorted(
            (item for item in found if item["team"] == team),
            key=lambda item: item["score"] + min(0.3, item["texture"] / 180),
            reverse=True,
        )
        team_picks = []
        for item in team_items:
            if all(
                (item["x"] - other["x"]) ** 2
                + (item["y"] - other["y"]) ** 2
                > 24**2
                for other in team_picks
            ):
                team_picks.append(item)
            if len(team_picks) == 12:
                break
        picked.extend(team_picks)
    return picked


def appearance_score(template: np.ndarray, candidate_patch: np.ndarray):
    if template.size == 0 or candidate_patch.size == 0:
        return 0.0
    candidate = cv2.resize(
        candidate_patch, (template.shape[1], template.shape[0])
    )
    template_gray = cv2.cvtColor(template, cv2.COLOR_BGR2GRAY)
    candidate_gray = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
    ncc = float(
        cv2.matchTemplate(
            candidate_gray, template_gray, cv2.TM_CCOEFF_NORMED
        )[0, 0]
    )
    template_hsv = cv2.cvtColor(template, cv2.COLOR_BGR2HSV)
    candidate_hsv = cv2.cvtColor(candidate, cv2.COLOR_BGR2HSV)
    template_hist = cv2.calcHist(
        [template_hsv], [0, 1], None, [12, 8], [0, 180, 0, 256]
    )
    candidate_hist = cv2.calcHist(
        [candidate_hsv], [0, 1], None, [12, 8], [0, 180, 0, 256]
    )
    cv2.normalize(template_hist, template_hist)
    cv2.normalize(candidate_hist, candidate_hist)
    histogram = float(
        cv2.compareHist(template_hist, candidate_hist, cv2.HISTCMP_CORREL)
    )
    return max(-1.0, min(1.0, ncc * 0.62 + histogram * 0.38))


def assign_candidates(trackers: list, states: list, candidates: list, frame: np.ndarray):
    """Assign detections using global appearance anchors plus local motion.

    A local-only tracker can permanently drift after one missed frame. Each
    frame therefore starts with a half-resolution whole-map template search.
    Reliable matches become anchors; the remaining tracks share the remaining
    ring detections under a one-to-one constraint.
    """
    proposals = []
    template_matches = []
    global_matches = []
    predictions = []
    small_frame = cv2.resize(
        frame,
        (max(1, frame.shape[1] // 2), max(1, frame.shape[0] // 2)),
    )
    scale_x = frame.shape[1] / small_frame.shape[1]
    scale_y = frame.shape[0] / small_frame.shape[0]

    for index, track in enumerate(trackers):
        state = states[index]
        predicted_x = float(
            np.clip(state["x"] + state["vx"], 0, frame.shape[1] - 1)
        )
        predicted_y = float(
            np.clip(state["y"] + state["vy"], 0, frame.shape[0] - 1)
        )
        match_x, match_y, match_confidence = match_track(
            frame,
            track["template"],
            predicted_x,
            predicted_y,
            search_radius=125,
        )
        predictions.append((predicted_x, predicted_y))
        template_matches.append((match_x, match_y, match_confidence))

        template = track["template"]
        template_small = cv2.resize(
            template,
            (
                max(12, template.shape[1] // 2),
                max(12, template.shape[0] // 2),
            ),
        )
        global_result = cv2.matchTemplate(
            small_frame, template_small, cv2.TM_CCOEFF_NORMED
        )
        _, global_score, _, global_location = cv2.minMaxLoc(global_result)
        global_x = (
            global_location[0] + template_small.shape[1] / 2
        ) * scale_x
        global_y = (
            global_location[1] + template_small.shape[0] / 2
        ) * scale_y
        global_matches.append(
            (float(global_x), float(global_y), float(global_score))
        )

    anchor_proposals = []
    for index, track in enumerate(trackers):
        global_x, global_y, global_score = global_matches[index]
        same_team = [
            (candidate_index, candidate)
            for candidate_index, candidate in enumerate(candidates)
            if candidate["team"] == track["team"]
        ]
        nearest_index = None
        nearest_distance = float("inf")
        for candidate_index, candidate in same_team:
            distance = math.hypot(
                candidate["x"] - global_x,
                candidate["y"] - global_y,
            )
            if distance < nearest_distance:
                nearest_index = candidate_index
                nearest_distance = distance

        anchor = False
        anchor_x, anchor_y = global_x, global_y
        reliability = global_score
        if global_score >= 0.78:
            anchor = True
        elif global_score >= 0.58 and nearest_distance <= 55:
            anchor = True
            reliability += 0.12
        elif global_score >= 0.48 and nearest_distance <= 38:
            anchor = True
            reliability += 0.08
            candidate = candidates[nearest_index]
            anchor_x, anchor_y = candidate["x"], candidate["y"]

        if anchor:
            anchor_proposals.append(
                (
                    reliability,
                    index,
                    anchor_x,
                    anchor_y,
                    global_score,
                    nearest_index if nearest_distance <= 55 else None,
                )
            )

    anchors = {}
    used_candidates = set()
    reserved_positions = []
    for (
        reliability,
        track_index,
        anchor_x,
        anchor_y,
        global_score,
        candidate_index,
    ) in sorted(anchor_proposals, reverse=True):
        if any(
            math.hypot(anchor_x - x, anchor_y - y) <= 26
            for x, y in reserved_positions
        ):
            continue
        if candidate_index is not None and candidate_index in used_candidates:
            continue
        anchors[track_index] = (
            anchor_x,
            anchor_y,
            global_score,
            candidate_index,
        )
        reserved_positions.append((anchor_x, anchor_y))
        if candidate_index is not None:
            used_candidates.add(candidate_index)

    for index, track in enumerate(trackers):
        if index in anchors:
            continue
        predicted_x, predicted_y = predictions[index]
        match_x, match_y, _ = template_matches[index]
        for candidate_index, candidate in enumerate(candidates):
            if (
                candidate_index in used_candidates
                or candidate["team"] != track["team"]
            ):
                continue
            distance_prediction = math.hypot(
                candidate["x"] - predicted_x,
                candidate["y"] - predicted_y,
            )
            distance_template = math.hypot(
                candidate["x"] - match_x,
                candidate["y"] - match_y,
            )
            distance = min(distance_prediction, distance_template)
            if distance > 225:
                continue
            appearance = appearance_score(
                track["template"], candidate["patch"]
            )
            cost = (
                distance / 160
                + (1 - max(-0.2, appearance)) * 0.58
                + (1 - min(1, candidate["score"])) * 0.22
            )
            proposals.append(
                (cost, index, candidate_index, appearance, distance)
            )

    assignments = {}
    used_tracks = set(anchors)
    for cost, track_index, candidate_index, appearance, distance in sorted(
        proposals, key=lambda item: item[0]
    ):
        if (
            track_index in used_tracks
            or candidate_index in used_candidates
            or cost > 2.05
        ):
            continue
        assignments[track_index] = (
            candidate_index,
            appearance,
            distance,
        )
        used_tracks.add(track_index)
        used_candidates.add(candidate_index)

    results = []
    occupied = list(reserved_positions)
    for index, track in enumerate(trackers):
        state = states[index]
        predicted_x, predicted_y = predictions[index]
        match_x, match_y, match_confidence = template_matches[index]
        global_score = global_matches[index][2]
        source = "predicted"
        detection_score = 0.0
        if index in anchors:
            next_x, next_y, global_score, candidate_index = anchors[index]
            if candidate_index is not None:
                detection_score = candidates[candidate_index]["score"]
            confidence = min(0.99, 0.62 + max(0, global_score) * 0.36)
            source = "global"
        elif index in assignments:
            candidate_index, appearance, _ = assignments[index]
            candidate = candidates[candidate_index]
            next_x = candidate["x"]
            next_y = candidate["y"]
            detection_score = candidate["score"]
            confidence = min(
                0.99,
                0.58
                + 0.24 * min(1, candidate["score"])
                + 0.18 * max(0, appearance),
            )
            source = "detected"
        elif match_confidence >= 0.38 and all(
            math.hypot(match_x - x, match_y - y) > 22
            for x, y in occupied
        ):
            next_x = match_x
            next_y = match_y
            confidence = min(0.74, match_confidence * 0.72)
            source = "template"
        else:
            next_x = predicted_x
            next_y = predicted_y
            confidence = 0.12

        delta_x = float(np.clip(next_x - state["x"], -125, 125))
        delta_y = float(np.clip(next_y - state["y"], -125, 125))
        if source in {"global", "detected"}:
            next_vx = state["vx"] * 0.4 + delta_x * 0.6
            next_vy = state["vy"] * 0.4 + delta_y * 0.6
        elif source == "template":
            next_vx = state["vx"] * 0.6 + delta_x * 0.4
            next_vy = state["vy"] * 0.6 + delta_y * 0.4
        else:
            next_vx = state["vx"] * 0.72
            next_vy = state["vy"] * 0.72

        states[index] = {
            "x": float(next_x),
            "y": float(next_y),
            "vx": float(next_vx),
            "vy": float(next_vy),
        }
        if index not in anchors:
            occupied.append((float(next_x), float(next_y)))
        results.append(
            {
                "x": float(next_x),
                "y": float(next_y),
                "confidence": float(confidence),
                "source": source,
                "detectionScore": float(detection_score),
                "globalScore": float(global_score),
            }
        )
    return results


def update_job(job_id: str, **values):
    with jobs_lock:
        jobs[job_id].update(values)


def run_analysis(job_id: str, payload: dict):
    try:
        path = payload["path"]
        info = video_info(path)
        crop = payload["crop"]
        markers = payload["markers"]
        calibration_second = float(payload.get("calibrationSecond", 61))
        playback_speed = max(0.25, float(payload.get("playbackSpeed", 4)))
        game_offset = float(payload.get("gameOffset", 2))
        game_sample_seconds = max(1, float(payload.get("sampleSeconds", 2)))
        video_step = game_sample_seconds / playback_speed

        calibration_frame = crop_frame(read_frame(path, calibration_second), crop)
        template_half = max(22, round(calibration_frame.shape[1] * 0.028))
        thumb_half = max(34, round(calibration_frame.shape[1] * 0.044))
        trackers = []
        for index, marker in enumerate(markers):
            x = float(marker["x"])
            y = float(marker["y"])
            template = safe_patch(calibration_frame, x, y, template_half)
            thumbnail = safe_patch(calibration_frame, x, y, thumb_half)
            trackers.append(
                {
                    "id": marker.get("id") or f"{marker['team']}-{index + 1}",
                    "team": marker["team"],
                    "template": template,
                    "thumbnail": image_data_url(thumbnail, 90),
                    "initial": (x, y),
                    "samples": [],
                }
            )

        forward_times = list(
            np.arange(calibration_second, info["duration"] + 0.001, video_step)
        )
        backward_times = list(
            np.arange(calibration_second - video_step, -0.001, -video_step)
        )
        total_steps = len(forward_times) + len(backward_times)
        completed = 0

        for direction, times in (("forward", forward_times), ("backward", backward_times)):
            states = [
                {"x": point[0], "y": point[1], "vx": 0.0, "vy": 0.0}
                for point in (track["initial"] for track in trackers)
            ]
            cap = cv2.VideoCapture(path)
            for video_second in times:
                cap.set(cv2.CAP_PROP_POS_MSEC, float(video_second * 1000))
                ok, frame = cap.read()
                if not ok:
                    completed += 1
                    continue
                map_frame = crop_frame(frame, crop)
                candidates = tracking_candidates(map_frame)
                tracked = assign_candidates(
                    trackers, states, candidates, map_frame
                )
                for index, track in enumerate(trackers):
                    tracked_point = tracked[index]
                    game_second = video_second * playback_speed + game_offset
                    track["samples"].append(
                        {
                            "t": round(game_second, 2),
                            "videoT": round(float(video_second), 2),
                            "x": round(
                                100
                                * tracked_point["x"]
                                / map_frame.shape[1],
                                3,
                            ),
                            "y": round(
                                100
                                * tracked_point["y"]
                                / map_frame.shape[0],
                                3,
                            ),
                            "confidence": round(
                                tracked_point["confidence"], 3
                            ),
                            "source": tracked_point["source"],
                            "detectionScore": round(
                                tracked_point["detectionScore"], 3
                            ),
                            "globalScore": round(
                                tracked_point["globalScore"], 3
                            ),
                            "direction": direction,
                        }
                    )
                completed += 1
                if completed % 4 == 0:
                    update_job(
                        job_id,
                        progress=round(100 * completed / max(1, total_steps)),
                        message=f"正在提取轨迹 · {completed}/{total_steps}",
                    )
            cap.release()

        players = []
        for track in trackers:
            samples = sorted(track["samples"], key=lambda item: item["t"])
            deduped = []
            for sample in samples:
                if deduped and abs(deduped[-1]["t"] - sample["t"]) < 0.01:
                    if sample["confidence"] > deduped[-1]["confidence"]:
                        deduped[-1] = sample
                else:
                    deduped.append(sample)
            players.append(
                {
                    "id": track["id"],
                    "team": track["team"],
                    "thumbnail": track["thumbnail"],
                    "samples": deduped,
                }
            )

        result = {
            "version": 1,
            "trackingVersion": 3,
            "createdAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source": {
                "path": path,
                "name": info["name"],
                "videoDuration": round(info["duration"], 2),
                "playbackSpeed": playback_speed,
                "gameOffset": game_offset,
                "gameDuration": round(info["duration"] * playback_speed + game_offset, 2),
                "sampleSeconds": game_sample_seconds,
            },
            "crop": crop,
            "players": players,
        }
        output_path = DATA_DIR / f"analysis-{time.strftime('%Y%m%d-%H%M%S')}.json"
        output_path.write_text(
            json.dumps(result, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        update_job(
            job_id,
            status="completed",
            progress=100,
            message="分析完成",
            result=result,
            outputPath=str(output_path),
        )
    except Exception as error:
        update_job(
            job_id,
            status="failed",
            message=str(error),
            error=repr(error),
        )


@app.get("/")
def index():
    return send_from_directory(UI_DIR, "index.html")


@app.get("/assets/<path:filename>")
def assets(filename: str):
    return send_from_directory(UI_DIR, filename)


@app.get("/api/defaults")
def defaults():
    return jsonify({"ok": True, "videoPath": DEFAULT_VIDEO})


@app.post("/api/resolve-videos")
def resolve_videos():
    payload = request.get_json(force=True)
    inputs = payload.get("paths") or []
    if isinstance(inputs, str):
        inputs = [inputs]
    resolved = []
    missing = []
    for raw_path in inputs:
        value = str(raw_path).strip().strip('"')
        if not value:
            continue
        path = Path(value)
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            resolved.append(str(path))
        elif path.is_dir():
            resolved.extend(
                str(item)
                for item in sorted(path.rglob("*"))
                if item.is_file() and item.suffix.lower() in VIDEO_EXTENSIONS
            )
        else:
            missing.append(value)
    unique = list(dict.fromkeys(resolved))
    if not unique:
        return json_error("没有找到可分析的视频文件")
    return jsonify({"ok": True, "paths": unique, "missing": missing})


@app.post("/api/inspect")
def inspect_video():
    payload = request.get_json(force=True)
    path = str(payload.get("path", "")).strip()
    if not path:
        return json_error("请填写视频路径")
    try:
        info = video_info(path)
        crop = payload.get("crop") or default_crop(info)
        calibration_second = min(
            max(0, float(payload.get("calibrationSecond", 61))),
            max(0, info["duration"] - 0.2),
        )
        frame = read_frame(path, calibration_second)
        map_image = crop_frame(frame, crop)
        markers = detect_markers(map_image)
        return jsonify(
            {
                "ok": True,
                "info": info,
                "crop": crop,
                "calibrationSecond": calibration_second,
                "preview": image_data_url(map_image, 90),
                "mapWidth": map_image.shape[1],
                "mapHeight": map_image.shape[0],
                "markers": markers,
            }
        )
    except Exception as error:
        return json_error(str(error))


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(force=True)
    markers = payload.get("markers") or []
    blue_count = sum(1 for marker in markers if marker.get("team") == "blue")
    red_count = sum(1 for marker in markers if marker.get("team") == "red")
    if blue_count != 5 or red_count != 5:
        return json_error("开始分析前，需要为蓝方和红方各标记 5 个英雄")
    job_id = uuid.uuid4().hex[:12]
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id,
            "status": "running",
            "progress": 0,
            "message": "正在准备视频分析",
        }
    thread = threading.Thread(
        target=run_analysis, args=(job_id, payload), daemon=True
    )
    thread.start()
    return jsonify({"ok": True, "jobId": job_id})


@app.post("/api/frame")
def video_frame():
    payload = request.get_json(force=True)
    try:
        path = str(payload["path"])
        crop = payload["crop"]
        if "videoSecond" in payload:
            video_second = float(payload["videoSecond"])
        else:
            speed = max(0.25, float(payload.get("playbackSpeed", 4)))
            offset = float(payload.get("gameOffset", 2))
            video_second = max(
                0, (float(payload.get("gameTime", 0)) - offset) / speed
            )
        frame = crop_frame(read_frame(path, video_second), crop)
        return jsonify(
            {
                "ok": True,
                "videoSecond": round(video_second, 3),
                "preview": image_data_url(frame, 84),
            }
        )
    except Exception as error:
        return json_error(str(error))


@app.get("/api/status/<job_id>")
def job_status(job_id: str):
    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return json_error("分析任务不存在", 404)
        response = {
            key: value
            for key, value in job.items()
            if key not in {"result", "error"}
        }
        if job.get("status") == "completed":
            response["result"] = job["result"]
        return jsonify({"ok": True, **response})


@app.get("/api/results")
def list_results():
    files = sorted(DATA_DIR.glob("analysis-*.json"), reverse=True)
    return jsonify(
        {
            "ok": True,
            "results": [
                {"name": path.name, "path": str(path), "size": path.stat().st_size}
                for path in files[:20]
            ],
        }
    )


if __name__ == "__main__":
    url = "http://127.0.0.1:8765"
    print()
    print("战术罗盘本地版已启动")
    print(f"访问地址：{url}")
    print("关闭此窗口即可停止程序")
    print()
    if os.environ.get("KPL_NO_BROWSER") != "1":
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    serve(app, host="127.0.0.1", port=8765, threads=8)
