import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Paleta de identidade do DataCold (espelha estilos/global.css).
class AppCores {
  static const azulNoite    = Color(0xFF0B1D3A);
  static const azulProfundo = Color(0xFF123B7A);
  static const azulMedio    = Color(0xFF1E6FD6);
  static const ciano        = Color(0xFF00B8F0);
  static const azulClaro    = Color(0xFF8EDBFF);
  static const azulGelo     = Color(0xFFE6F6FF);
  static const branco       = Color(0xFFFFFFFF);
  static const texto        = Color(0xFF0F172A);
  static const textoSuave   = Color(0xFF5B6B86);
  static const borda        = Color(0xFFE5E9F2);
  static const painelSoft   = Color(0xFFF4F8FF);

  static const ok     = Color(0xFF16A34A);
  static const alerta = Color(0xFFD97706);
  static const erro   = Color(0xFFDC2626);

  static const gradVibrante = LinearGradient(
    begin: Alignment.topLeft, end: Alignment.bottomRight,
    colors: [azulMedio, ciano],
  );
}

/// Tema Material 3 do app — Inter via google_fonts.
class AppTema {
  static ThemeData claro() {
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        primary: AppCores.azulMedio,
        secondary: AppCores.ciano,
        surface: AppCores.branco,
        error: AppCores.erro,
        onPrimary: Colors.white,
        onSurface: AppCores.texto,
      ),
      scaffoldBackgroundColor: const Color(0xFFFAFCFF),
    );

    return base.copyWith(
      textTheme: GoogleFonts.interTextTheme(base.textTheme).apply(
        bodyColor: AppCores.texto,
        displayColor: AppCores.azulNoite,
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: AppCores.branco.withOpacity(0.92),
        foregroundColor: AppCores.azulNoite,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: GoogleFonts.inter(
          fontSize: 14, fontWeight: FontWeight.w700,
          color: AppCores.azulNoite, letterSpacing: -0.1,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppCores.azulGelo,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppCores.borda),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppCores.borda),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: const BorderSide(color: AppCores.azulMedio, width: 2),
        ),
        labelStyle: GoogleFonts.inter(
          fontSize: 13, fontWeight: FontWeight.w500, color: AppCores.textoSuave,
        ),
        hintStyle: GoogleFonts.inter(
          fontSize: 13, color: AppCores.textoSuave,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppCores.azulMedio,
          foregroundColor: Colors.white,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: GoogleFonts.inter(
            fontSize: 14, fontWeight: FontWeight.w700, letterSpacing: 0.2,
          ),
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppCores.azulProfundo,
          side: const BorderSide(color: AppCores.borda),
          minimumSize: const Size.fromHeight(48),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
          textStyle: GoogleFonts.inter(
            fontSize: 13, fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppCores.azulMedio,
          textStyle: GoogleFonts.inter(
            fontSize: 13, fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}
