allprojects {
    repositories {
        // Local mirror first: the JVM DNS resolver on this machine is broken
        // (curl resolves fine, Java doesn't), so artifacts were pre-seeded
        // here via curl --resolve. Gradle resolves from disk, no DNS needed.
        maven { url = uri("file:///private/var/folders/1t/sw5y0cq10w38rtqk1njst73m0000gn/T/opencode/local-maven") }
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
