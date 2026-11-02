import math
import os
import sys

from PIL import Image, ImageDraw

SIZE = 48
GRID = 64
SCALE = 4
BIG = GRID * SCALE
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', 'src', 'native', 'map', 'icons')

COLORS = {
    'health': (200, 84, 84),
    'pharmacy': (62, 150, 100),
    'safety': (74, 110, 200),
    'money': (52, 130, 110),
    'fuel': (214, 134, 40),
    'worship': (50, 142, 142),
    'lodging': (130, 98, 180),
    'market': (156, 112, 70),
    'public': (110, 122, 136),
    'food': (222, 150, 52),
    'shop': (178, 100, 140),
}
WHITE = (255, 255, 255, 255)


def px(value):
    return value * SCALE


def base(color):
    image = Image.new('RGBA', (BIG, BIG), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.ellipse([px(4), px(4), px(60), px(60)], fill=WHITE)
    draw.ellipse([px(7), px(7), px(57), px(57)], fill=color + (255,))
    return image, draw


def cross(draw, arm=7, length=17):
    draw.rectangle([px(32 - arm), px(32 - length), px(32 + arm), px(32 + length)], fill=WHITE)
    draw.rectangle([px(32 - length), px(32 - arm), px(32 + length), px(32 + arm)], fill=WHITE)


def shield(draw):
    draw.polygon([(px(32), px(14)), (px(46), px(19)), (px(46), px(33)), (px(32), px(50)), (px(18), px(33)), (px(18), px(19))], fill=WHITE)


def coin(draw, color):
    draw.ellipse([px(17), px(17), px(47), px(47)], fill=WHITE)
    draw.ellipse([px(23), px(23), px(41), px(41)], fill=color + (255,))
    draw.ellipse([px(27), px(27), px(37), px(37)], fill=WHITE)


def drop(draw, color):
    draw.polygon([(px(32), px(13)), (px(44), px(33)), (px(20), px(33))], fill=WHITE)
    draw.ellipse([px(20), px(24), px(44), px(48)], fill=WHITE)


def crescent(draw, color):
    draw.ellipse([px(16), px(16), px(48), px(48)], fill=WHITE)
    draw.ellipse([px(24), px(12), px(54), px(44)], fill=color + (255,))
    for angle in range(0, 360, 72):
        a = math.radians(angle - 90)
        draw.ellipse([px(42 + 4 * math.cos(a) - 2), px(36 + 4 * math.sin(a) - 2), px(42 + 4 * math.cos(a) + 2), px(36 + 4 * math.sin(a) + 2)], fill=WHITE)


def house(draw):
    draw.polygon([(px(32), px(14)), (px(50), px(31)), (px(14), px(31))], fill=WHITE)
    draw.rectangle([px(18), px(31), px(46), px(48)], fill=WHITE)


def basket(draw, color):
    draw.polygon([(px(14), px(26)), (px(50), px(26)), (px(44), px(48)), (px(20), px(48))], fill=WHITE)
    draw.arc([px(22), px(12), px(42), px(36)], 180, 360, fill=WHITE, width=px(4))
    for x in (26, 32, 38):
        draw.line([(px(x), px(30)), (px(x - 1), px(44))], fill=color + (255,), width=px(2))


def pillars(draw):
    draw.polygon([(px(32), px(13)), (px(52), px(26)), (px(12), px(26))], fill=WHITE)
    for x in (18, 28, 38):
        draw.rectangle([px(x), px(29), px(x + 7), px(45)], fill=WHITE)
    draw.rectangle([px(13), px(47), px(51), px(51)], fill=WHITE)


def fork(draw):
    for x in (24, 32, 40):
        draw.rectangle([px(x - 1.5), px(14), px(x + 1.5), px(30)], fill=WHITE)
    draw.rectangle([px(24), px(26), px(40), px(31)], fill=WHITE)
    draw.rounded_rectangle([px(29.5), px(28), px(34.5), px(50)], radius=px(2), fill=WHITE)


def bag(draw, color):
    draw.rectangle([px(17), px(26), px(47), px(50)], fill=WHITE)
    draw.arc([px(23), px(13), px(41), px(37)], 180, 360, fill=WHITE, width=px(4))


DRAWERS = {
    'food': lambda d, c: fork(d),
    'shop': bag,
    'health': lambda d, c: cross(d),
    'pharmacy': lambda d, c: cross(d, arm=6, length=16),
    'safety': lambda d, c: shield(d),
    'money': coin,
    'fuel': drop,
    'worship': crescent,
    'lodging': lambda d, c: house(d),
    'market': basket,
    'public': lambda d, c: pillars(d),
}

os.makedirs(OUT, exist_ok=True)
for name, color in COLORS.items():
    image, draw = base(color)
    DRAWERS[name](draw, color)
    image.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, f'geo-{name}.png'), optimize=True)
print(len(COLORS))
