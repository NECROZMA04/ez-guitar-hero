export { RNG };

/**
 * RNG (Random Number Generator) class provides methods to generate pseudo-random numbers.
 * It uses a Linear Congruential Generator (LCG) algorithm with specific constants.
 */
abstract class RNG {
    // Constants for the LCG algorithm
    private static modulus = 0x80000000; // 2**31
    private static multiplier = 1103515245;
    private static increment = 12345;

    /**
     * Generates a hash from a given seed using the LCG algorithm.
     * This method can be called repeatedly to generate a sequence of hashes.
     * @param seed The initial seed value for hashing
     * @returns A hash of the seed
     */
    public static hash = (seed: number) =>
        (RNG.multiplier * seed + RNG.increment) % RNG.modulus;

    /**
     * Scales a hash value to the range [0, 1].
     * This is useful for normalizing the output of the hash function for applications such as random number generation.
     * @param hash The hash value to scale
     * @returns The scaled value in the range [0, 1]
     */
    public static scale = (hash: number) =>
        ((2 * hash) / (RNG.modulus - 1) - 1 + 1) / 2;
}
