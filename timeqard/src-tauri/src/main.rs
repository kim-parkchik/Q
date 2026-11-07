// Windows で、配るもの（release）を開いたときに、黒い窓（コンソール）を出さない。消さないこと
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    timeqard_lib::run()
}
