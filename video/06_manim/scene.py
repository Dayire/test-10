"""Demo 06 — Manim Community (3Blue1Brown's own engine). The thrust equation, written, substituted, compared with weight."""
from manim import *
BLUE_, YELLOW_, RED_, GREEN_, TEAL_, GREY_ = "#58C4DD", "#FFFF00", "#FC6255", "#83C167", "#5CD0B3", "#888888"
SERIF, SANS = "STIXGeneral", "DejaVu Sans"

class Thrust(Scene):
    def construct(self):
        self.camera.background_color = "#000000"
        title = Text("THRUST", font=SANS, font_size=22, color=TEAL_).to_edge(UP, buff=0.55)
        F = Text("F", font=SERIF, slant=ITALIC, font_size=84)
        eqs = Text("=", font=SERIF, font_size=84)
        mdot = Text("ṁ", font=SERIF, slant=ITALIC, font_size=84, color=BLUE_)
        dot = Text("·", font=SERIF, font_size=84)
        ve = MarkupText('<i>v</i><sub><i>e</i></sub>', font=SERIF, font_size=84, color=YELLOW_)
        eq = VGroup(F, eqs, mdot, dot, ve).arrange(RIGHT, buff=0.35).shift(UP * 1.1)
        l1 = Text("mass thrown out per second", font=SANS, font_size=22, color=BLUE_).next_to(mdot, DOWN, buff=0.55)
        l2 = Text("how fast it leaves", font=SANS, font_size=22, color=YELLOW_).next_to(ve, DOWN, buff=0.55)
        self.play(FadeIn(title), run_time=0.3)
        self.play(Write(eq), run_time=1.1)
        self.play(FadeIn(l1, shift=UP * 0.2), FadeIn(l2, shift=UP * 0.2), run_time=0.5)
        # substitute the launcher's numbers: nine engines, 2,745 kg of gas every second at 2,770 m/s
        n1 = Text("2,745 kg/s", font=SERIF, font_size=60, color=BLUE_)
        n2 = Text("2,770 m/s", font=SERIF, font_size=60, color=YELLOW_)
        eq2 = VGroup(F.copy(), eqs.copy(), n1, dot.copy(), n2).arrange(RIGHT, buff=0.35).move_to(eq)
        self.play(TransformMatchingShapes(eq, eq2), FadeOut(l1), FadeOut(l2), run_time=0.8)
        res = Text("F = 7.6 MN", font=SERIF, font_size=84, color=RED_).move_to(eq)
        res[0].set_slant(ITALIC)
        self.play(TransformMatchingShapes(eq2, res), run_time=0.7)
        # thrust versus weight, as two bars
        bar_t = Rectangle(width=7.6 * 0.6, height=0.45, fill_color=RED_, fill_opacity=1, stroke_width=0).shift(DOWN * 0.9).align_to(LEFT * 3.2, LEFT)
        bar_w = Rectangle(width=5.4 * 0.6, height=0.45, fill_color=GREY_, fill_opacity=1, stroke_width=0).shift(DOWN * 1.7).align_to(LEFT * 3.2, LEFT)
        lt = Text("thrust  7.6 MN", font=SANS, font_size=24, color=RED_).next_to(bar_t, RIGHT, buff=0.3)
        lw = Text("weight  549 t × g = 5.4 MN", font=SANS, font_size=24, color=GREY_).next_to(bar_w, RIGHT, buff=0.3)
        self.play(GrowFromEdge(bar_t, LEFT), GrowFromEdge(bar_w, LEFT), FadeIn(lt), FadeIn(lw), run_time=0.8)
        lift = Text("thrust > weight   →   liftoff at 0.4 g", font=SANS, font_size=28, color=GREEN_).shift(DOWN * 2.8)
        self.play(FadeIn(lift, shift=UP * 0.2), run_time=0.5)
        self.wait(0.3)
