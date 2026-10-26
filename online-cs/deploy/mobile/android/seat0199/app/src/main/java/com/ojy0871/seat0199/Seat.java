package com.ojy0871.seat0199;

final class Seat {
    final String name;
    final String code;

    Seat(String name, String code) {
        this.name = name;
        this.code = code;
    }

    String label() {
        return name + "（" + code + "）";
    }
}
