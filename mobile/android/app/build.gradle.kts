plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.inkvoice.keyboard"
    compileSdk = 35
    ndkVersion = "28.2.13676358"
    defaultConfig {
        applicationId = "org.inkvoice.keyboard"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-preview.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        val requestedAbis = providers.gradleProperty("inkvoiceAbis")
            .orElse("arm64-v8a,x86_64").get().split(',').map { it.trim() }.filter { it.isNotEmpty() }
        ndk { abiFilters += requestedAbis }
        externalNativeBuild {
            cmake { arguments += listOf("-DANDROID_STL=c++_shared", "-DGGML_NATIVE=OFF") }
        }
    }
    buildTypes {
        release { isMinifyEnabled = false }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    externalNativeBuild {
        cmake { path = file("src/main/cpp/CMakeLists.txt"); version = "3.22.1" }
    }
    testOptions { unitTests.isReturnDefaultValues = true }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
}
